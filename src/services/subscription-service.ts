// T-007, T-006 (seed-v3, AC-002, AC-003, AC-001) — 결제/구독 Logic 레이어.
// Pair Mode(Navigator Plan A)로 설계됨 — 근거는 각 함수 주석 참고.
import * as paymentMethodRepository from "@/lib/data/payment-method-repository";
import * as subscriptionRepository from "@/lib/data/subscription-repository";
import * as tossClient from "@/lib/data/toss-client";
import { DuplicatePaymentMethodError } from "@/lib/data/errors";
import type { PaymentMethodRecord, SubscriptionRecord } from "@/lib/data/records";
import type { SubscriptionPlan } from "@/types/dto";

export type SubscriptionErrorCode =
  | "PAYMENT_METHOD_ALREADY_EXISTS"
  | "BILLING_KEY_ISSUE_FAILED"
  | "SUBSCRIPTION_CREATE_FAILED"
  | "NO_CANCELABLE_SUBSCRIPTION"
  | "NO_PAYMENT_METHOD"
  | "SUBSCRIPTION_ALREADY_ACTIVE"
  | "CHARGE_FAILED";

export class SubscriptionError extends Error {
  code: SubscriptionErrorCode;
  constructor(code: SubscriptionErrorCode, message: string) {
    super(message);
    this.name = "SubscriptionError";
    this.code = code;
  }
}

const TRIAL_PERIOD_DAYS = 7;
const PLAN_AMOUNT_KRW: Record<SubscriptionPlan, number> = {
  monthly: 9_900,
  yearly: 99_000, // 월간가 x10 (2개월치 할인, seed-v3 인터뷰 결정)
};

/**
 * (seed-v3, AC-002, AC-003) 무료체험 시작 — "카드 등록 = trial 시작 조건",
 * "카드 변경 기능 없음"을 결합하면 "무료체험은 User 생애주기 1회"가 유일하게
 * 성립하는 해석이다(Ontologist 분석, seed-v3.yaml tech_decisions).
 *
 * 사전 확인(findByUserId)은 UX/불필요한 토스 API 호출 방지용 최적화일 뿐,
 * 실제 방어선은 payment_methods.user_id UNIQUE 제약이다(Navigator Plan A) —
 * 동시 요청(TOCTOU)이 사전 확인을 통과해도 DB insert 단계에서
 * DuplicatePaymentMethodError로 걸린다.
 *
 * ⚠️ PaymentMethod 생성 성공 후 Subscription 생성이 실패하면(예: DB 일시 장애),
 * "카드는 등록됐는데 구독 이력이 전혀 없는" 영구 락 상태가 된다 — StartFreeTrial
 * 재호출은 불변식으로 막혀있고 Resubscribe는 즉시 유료 청구라 무료체험을
 * 건너뛰게 되어 의도를 어긴다. auth-service.signUp과 동일한 보상 롤백 패턴으로
 * 막는다(Navigator 리뷰).
 */
export async function startFreeTrial(
  userId: string,
  plan: SubscriptionPlan,
  authKey: string
): Promise<{ paymentMethod: PaymentMethodRecord; subscription: SubscriptionRecord }> {
  const existing = await paymentMethodRepository.findByUserId(userId);
  if (existing) {
    throw new SubscriptionError("PAYMENT_METHOD_ALREADY_EXISTS", "이미 결제수단이 등록되어 있어 무료체험을 다시 시작할 수 없습니다");
  }

  let issued;
  try {
    issued = await tossClient.issueBillingKey(authKey, userId);
  } catch (err) {
    throw new SubscriptionError("BILLING_KEY_ISSUE_FAILED", `카드 등록에 실패했습니다: ${(err as Error).message}`);
  }

  let paymentMethod: PaymentMethodRecord;
  try {
    paymentMethod = await paymentMethodRepository.create({
      userId,
      billingKey: issued.billingKey,
      cardLast4: issued.cardLast4,
    });
  } catch (err) {
    if (err instanceof DuplicatePaymentMethodError) {
      // 사전 확인 이후 레이스로 먼저 등록된 경우 — 방금 발급받은 billingKey는
      // 저장하지 않고 버린다(카드 변경 기능이 non-goal이라 토스 측 정리 API를
      // 부를 대상도 없다 — 실제 청구가 일어나지 않으므로 금전적 위험은 없다).
      throw new SubscriptionError("PAYMENT_METHOD_ALREADY_EXISTS", "이미 결제수단이 등록되어 있어 무료체험을 다시 시작할 수 없습니다");
    }
    throw new SubscriptionError("SUBSCRIPTION_CREATE_FAILED", `결제수단 저장에 실패했습니다: ${(err as Error).message}`);
  }

  const now = new Date();
  const trialEndAt = new Date(now.getTime() + TRIAL_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  try {
    const subscription = await subscriptionRepository.create({
      userId,
      plan,
      amount: PLAN_AMOUNT_KRW[plan],
      status: "trial",
      trialEndAt: trialEndAt.toISOString(),
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: trialEndAt.toISOString(),
      nextBillingAt: trialEndAt.toISOString(),
    });
    return { paymentMethod, subscription };
  } catch (err) {
    await paymentMethodRepository.deleteByUserId(userId);
    throw new SubscriptionError(
      "SUBSCRIPTION_CREATE_FAILED",
      `구독 생성에 실패해 등록된 결제수단을 롤백했습니다: ${(err as Error).message}`
    );
  }
}

/**
 * (seed-v3, AC-006) 해지 — ontology의 CancelSubscription.input은 "없음"이다.
 * 클라이언트가 넘긴 subscription id를 절대 신뢰하지 않고, 서버가
 * findLatestByUserId로 직접 대상을 특정한다(callback route에서 이미 세운
 * "클라이언트가 되돌려준 식별자로 금전 관련 액션을 특정하지 않는다" 원칙을
 * 여기서도 그대로 지킨다, Navigator 리뷰).
 *
 * status/canceledAt/nextBillingAt만 갱신하고 current_period_end는 건드리지
 * 않는다 — checkAICoachAccess의 해지 유예 판정이 그 필드를 그대로 읽으므로,
 * 해지 직후에도 유예기간 동안은 계속 접근 가능하다(seed invariant).
 *
 * 더블클릭 등 동시 해지 요청은 별도 락 없이 자연스럽게 막힌다 — 매 호출이
 * findLatestByUserId로 최신 상태를 다시 읽으므로, 이미 canceled로 바뀐 뒤의
 * 두 번째 호출은 "해지 가능한 구독 없음"으로 멱등 실패한다(금전 위험이 없어
 * PaymentMethod처럼 DB 제약 락이 필요 없다, GEN-003).
 */
export async function cancelSubscription(userId: string): Promise<SubscriptionRecord> {
  const subscription = await subscriptionRepository.findLatestByUserId(userId);
  if (!subscription || (subscription.status !== "trial" && subscription.status !== "active")) {
    throw new SubscriptionError("NO_CANCELABLE_SUBSCRIPTION", "해지할 수 있는 구독이 없습니다");
  }

  return subscriptionRepository.updateStatus(subscription.id, {
    status: "canceled",
    canceledAt: new Date().toISOString(),
    nextBillingAt: null,
  });
}

/**
 * (seed-v3, AC-008, AC-004) 결제 주기 계산 — 재구독(동기)과 일일 정기결제 배치
 * (AC-004) 양쪽에서 재사용할 공용 헬퍼다.
 *
 * ⚠️ `Date.setMonth`/`setFullYear`를 단순히 +1만 하면 날짜 오버플로 버그가
 * 실제로 생긴다 — 1월 31일에 1개월을 더하면 "2월 31일"이 없어 JS Date가
 * 자동으로 3월 3일로 넘겨버린다(2월이 28/29일뿐이라). 이러면 매달 결제일이
 * 조금씩 뒤로 밀리는, 결제 도메인에서 절대 허용할 수 없는 클래스의 버그가
 * 된다. 목표 월의 실제 마지막 날로 clamp해서 막는다(Navigator Plan A).
 */
export function addBillingPeriod(start: Date, plan: SubscriptionPlan): Date {
  const year = start.getFullYear();
  const month = start.getMonth();
  const day = start.getDate();

  if (plan === "monthly") {
    const targetMonth = month + 1;
    const lastDayOfTargetMonth = new Date(year, targetMonth + 1, 0).getDate();
    const clampedDay = Math.min(day, lastDayOfTargetMonth);
    const result = new Date(start);
    result.setFullYear(year, targetMonth, clampedDay);
    return result;
  }

  // yearly — 2/29(윤년) 다음 해가 평년이면 마지막 날(2/28)로 clamp.
  const targetYear = year + 1;
  const lastDayOfTargetMonth = new Date(targetYear, month + 1, 0).getDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);
  const result = new Date(start);
  result.setFullYear(targetYear, month, clampedDay);
  return result;
}

/**
 * (seed-v3, AC-008) 재구독 — ontology의 Resubscribe는 "PaymentMethod는 있지만
 * 유효한 Subscription이 없는 User"에게만 허용된다. 자격 판정은 의도적으로
 * checkAICoachAccess를 재사용하지 않고 독립적으로 구현한다 — 이름 그대로
 * "AI 코치 접근 판정"과 "재구독 가능 여부"는 지금은 결론이 겹치지만 별개
 * 개념이라, 결합해두면 나중에 한쪽만 바뀔 때(예: 다른 기능도 구독에 묶는
 * 확장) 조용히 같이 어긋날 수 있다(Navigator Plan A).
 *
 * canceled + 유예 중(current_period_end가 아직 안 지남)인 User는 재구독
 * 대상이 아니다 — 남은 유예기간을 버리고 지금 다시 결제할 이유가 없다
 * (AC-008 설명의 "canceled 후 만료됐거나 past_due" 괄호를 그대로 해석).
 *
 * 실패(카드 거절 등)는 PaymentAttempt로 기록하지 않는다 — TRD tech_decisions에
 * 이미 확정된 결정(사용자가 화면 앞에서 즉시 재시도 가능한 동기적 실패는
 * 영구 기록 가치가 낮음)을 그대로 따른다.
 *
 * ⚠️ 이중 청구 방지(Navigator 리뷰, RETRY 사유): 두 재구독 요청이 거의 동시에
 * 들어오면 둘 다 findLatestByUserId에서 같은 과거 레코드를 읽고 둘 다 자격
 * 판정을 통과해버릴 수 있다 — orderId를 매번 새로 발급해도(crypto.randomUUID)
 * 토스 입장에서는 "재시도"가 아니라 "별개의 정상 청구 2건"이라 실제로 카드에
 * 두 번 청구될 위험이 있다. past_due 기원 재구독은 charge 호출 **전에**
 * markPastDueAsExpired로 그 레코드를 조건부(WHERE status='past_due') 선점해,
 * 레이스에서 진 요청은 charge를 아예 호출하지 않고 중단한다(DB UPDATE의
 * 원자성을 락처럼 사용 — payment_methods UNIQUE 제약과 같은 계열의 방어).
 * canceled+기간종료/expired 기원 재구독은 "선점할 살아있는 레코드"가 없어
 * 같은 방식의 DB 락을 걸 자리가 없다 — Presentation의 버튼
 * pending-disable(ResubscribeButton.tsx)은 같은 탭에서의 실수 더블클릭만
 * 막을 뿐, 멀티탭/새로고침 후 재요청 같은 현실적 경로는 막지 못한다(2026-09-16,
 * /evolve Contrarian 리뷰로 지적됨). 이 경로엔 대신 토스페이먼츠 공식
 * Idempotency-Key(하루 단위로 고정된 값)를 chargeBilling에 실어 보낸다 —
 * 같은 User가 같은 날 두 번 요청해도 토스 서버가 두 번째 요청을 "이미 처리한
 * 요청"으로 인식해 실제 카드 청구는 한 번만 일어난다(/evolve Researcher가
 * 확인한 토스 공식 지원 헤더). DB 락이 아니라 PG 레벨 방어라는 점은 다르지만,
 * "실제로 두 번 청구되는 것"은 동일하게 막는다.
 */
export async function resubscribe(userId: string, plan: SubscriptionPlan): Promise<SubscriptionRecord> {
  const paymentMethod = await paymentMethodRepository.findByUserId(userId);
  if (!paymentMethod) {
    throw new SubscriptionError("NO_PAYMENT_METHOD", "등록된 결제수단이 없어 재구독할 수 없습니다");
  }

  const subscription = await subscriptionRepository.findLatestByUserId(userId);
  const hasActiveOrGrace =
    subscription &&
    (subscription.status === "trial" ||
      subscription.status === "active" ||
      (subscription.status === "canceled" && new Date(subscription.currentPeriodEnd) >= new Date()));
  if (hasActiveOrGrace) {
    throw new SubscriptionError("SUBSCRIPTION_ALREADY_ACTIVE", "이미 이용 중인 구독이 있습니다");
  }

  if (subscription && subscription.status === "past_due") {
    const wonRace = await subscriptionRepository.markPastDueAsExpired(subscription.id);
    if (!wonRace) {
      // 동시에 들어온 다른 재구독 요청이 먼저 이 레코드를 가져갔다 —
      // chargeBilling을 호출하지 않고 즉시 중단해 이중 청구를 막는다.
      throw new SubscriptionError("SUBSCRIPTION_ALREADY_ACTIVE", "이미 처리 중인 재구독 요청이 있습니다");
    }
  }

  const amount = PLAN_AMOUNT_KRW[plan];
  const today = new Date().toISOString().slice(0, 10); // UTC 날짜(YYYY-MM-DD) — findDueToday와 동일한 하루 경계 기준.
  try {
    await tossClient.chargeBilling(paymentMethod.billingKey, {
      customerKey: userId,
      amount,
      orderId: crypto.randomUUID(),
      orderName: "동행 AI 코치 구독",
      idempotencyKey: `resubscribe:${userId}:${today}`,
    });
  } catch (err) {
    throw new SubscriptionError("CHARGE_FAILED", `결제에 실패했습니다: ${(err as Error).message}`);
  }

  const now = new Date();
  const periodEnd = addBillingPeriod(now, plan);

  return subscriptionRepository.create({
    userId,
    plan,
    amount,
    status: "active",
    trialEndAt: null,
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: periodEnd.toISOString(),
    nextBillingAt: periodEnd.toISOString(),
  });
}

export type AICoachAccessReason =
  | "trial_active"
  | "paid_active"
  | "grace_until_period_end"
  | "blocked:past_due"
  | "blocked:expired"
  | "blocked:no_subscription";

export interface AICoachAccessResult {
  allowed: boolean;
  reason: AICoachAccessReason;
}

/**
 * (seed-v3, AC-001) `/chat` 진입 게이트 — 최신 Subscription 1건으로 접근 여부를
 * 판정한다. seed ontology(CheckAICoachAccess 액션, 5개 status 상태머신)가 이미
 * 확정해둔 값 전부를 지금 정확히 구현한다 — "혹시 몰라서" 짜는 speculative
 * 코드가 아니라 이미 계약된 스펙이다(Navigator Plan A, DB CHECK 제약/타입도
 * AC-002/003 라운드에서 이미 5개 값 전부로 확정됨).
 *
 * ⚠️ canceled 분기는 status 필드만 보지 않고 current_period_end와 now를 직접
 * 비교한다 — 일일 cron(ExpireCanceledSubscriptions, AC-007)이 하루 한 번만
 * 돌므로, 해지 기간이 지났는데도 status가 아직 "canceled"인 채로 남아있는
 * 레코드가 실제로 존재할 수 있다. status만 믿으면 이미 만료된 유저를 잘못
 * 통과시킨다.
 */
export async function checkAICoachAccess(userId: string): Promise<AICoachAccessResult> {
  const subscription = await subscriptionRepository.findLatestByUserId(userId);
  if (!subscription) {
    return { allowed: false, reason: "blocked:no_subscription" };
  }

  switch (subscription.status) {
    case "trial":
      return { allowed: true, reason: "trial_active" };
    case "active":
      return { allowed: true, reason: "paid_active" };
    case "canceled":
      return new Date(subscription.currentPeriodEnd) >= new Date()
        ? { allowed: true, reason: "grace_until_period_end" }
        : { allowed: false, reason: "blocked:expired" };
    case "past_due":
      return { allowed: false, reason: "blocked:past_due" };
    case "expired":
      return { allowed: false, reason: "blocked:expired" };
    default: {
      // seed ontology의 SubscriptionStatus는 5개 값으로 닫혀있다 — 미래에
      // 상태가 추가되면 여기서 컴파일 타임에 걸린다(exhaustiveness check).
      const _exhaustive: never = subscription.status;
      throw new Error(`처리되지 않은 SubscriptionStatus: ${_exhaustive}`);
    }
  }
}

export interface SubscriptionStatusView {
  hasSubscription: boolean;
  plan?: SubscriptionPlan;
  reason?: AICoachAccessReason;
  nextBillingAt?: string | null;
  currentPeriodEnd?: string;
}

/**
 * (seed-v3, AC-009) `/subscription` 페이지가 상태/플랜/날짜를 표시하는 데
 * 필요한 전체 조회. checkAICoachAccess를 재사용해 reason을 얻는다 — 유예기간
 * 판정(current_period_end 비교) 로직을 여기서 다시 구현하지 않는다. 이미
 * AC-001에서 테스트로 검증된 정확성이 중요한 코드라, 복제하면 나중에 한쪽만
 * 수정되는 드리프트 위험이 생긴다(resubscribe의 독립 가드와는 반대 이유 —
 * 그때는 의미가 달라 분리했지만, 여기는 정확히 같은 판정을 재사용하는
 * 것뿐이라 복제가 아니라 재사용이 맞다, Navigator Plan A).
 *
 * DB 조회가 2번(findLatestByUserId + checkAICoachAccess 내부의 또 한 번)
 * 발생하지만, 트래픽이 낮은 관리 화면이라 무해하다고 판단했다.
 */
export async function getSubscriptionStatus(userId: string): Promise<SubscriptionStatusView> {
  const subscription = await subscriptionRepository.findLatestByUserId(userId);
  if (!subscription) {
    return { hasSubscription: false };
  }

  const access = await checkAICoachAccess(userId);
  return {
    hasSubscription: true,
    plan: subscription.plan,
    reason: access.reason,
    nextBillingAt: subscription.nextBillingAt,
    currentPeriodEnd: subscription.currentPeriodEnd,
  };
}
