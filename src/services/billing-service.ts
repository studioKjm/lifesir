// T-010, T-011 (seed-v3, AC-004, AC-005, AC-007) — 일일 정기결제/만료정리 배치 오케스트레이션.
// subscription-service.ts와 별도 파일로 분리한 이유: subscription-service의
// 함수들은 "이 요청 하나를 정확히 처리"하는 사용자 트리거 액션(startFreeTrial/
// resubscribe/cancelSubscription)인 반면, 이 파일은 "N개를 처리하되 하나가
// 죽어도 나머지는 계속 진행"하는 배치 오케스트레이션이라 관심사가 다르다
// (Navigator Plan A).
import * as subscriptionRepository from "@/lib/data/subscription-repository";
import * as paymentMethodRepository from "@/lib/data/payment-method-repository";
import * as paymentAttemptRepository from "@/lib/data/payment-attempt-repository";
import * as tossClient from "@/lib/data/toss-client";
import { TossApiError } from "@/lib/data/toss-client";
import { addBillingPeriod } from "@/services/subscription-service";
import type { SubscriptionRecord } from "@/lib/data/records";

export type BillingOutcome = "success" | "failure" | "partial_failure" | "error";

export interface BillingResultItem {
  subscriptionId: string;
  outcome: BillingOutcome;
}

/**
 * (seed-v3, AC-004, AC-005) 오늘 청구 대상(subscriptionRepository.findDueToday)을
 * 순회하며 각각 정기결제를 실행한다. 순차 처리(병렬 아님) — 토스 API에 동시
 * 다발 요청을 보내지 않고 동작을 결정론적으로 유지한다(Navigator Plan A).
 *
 * 루프 격리: 각 건을 개별 try/catch로 감싸 한 건의 예상 못 한 예외가 나머지
 * 건 처리를 막지 않는다 — 배치 작업에서 한 유저의 문제가 다른 유저 청구를
 * 막으면 안 된다(GEN-003: 이건 "실제로 처리 가능한 지점"이다).
 */
export async function runDailyBilling(): Promise<BillingResultItem[]> {
  const dueSubscriptions = await subscriptionRepository.findDueToday();
  const results: BillingResultItem[] = [];

  for (const sub of dueSubscriptions) {
    try {
      results.push(await processSingleBilling(sub));
    } catch (err) {
      console.error(`[billing-service] 정기결제 처리 중 예상 못 한 예외 (subscriptionId=${sub.id})`, err);
      results.push({ subscriptionId: sub.id, outcome: "error" });
    }
  }

  return results;
}

async function processSingleBilling(sub: SubscriptionRecord): Promise<BillingResultItem> {
  // ⚠️ 이중 청구 방지(2026-09-16, Test Designer 리뷰로 발견) — chargeBilling
  // 호출 전에 이 청구 슬롯을 조건부로 먼저 선점한다. /api/cron/billing이
  // 겹쳐 호출되면(수동 curl 확인이 실제 스케줄 실행과 겹치는 등) 두 호출 다
  // findDueToday에서 같은 레코드를 읽을 수 있는데, 실제로 next_billing_at을
  // 먼저 비우는(claim) 쪽만 charge를 진행한다 — resubscribe의
  // markPastDueAsExpired와 동일한 방어 패턴(AC-008).
  //
  // 선점 후 charge가 성공하면 handleChargeSuccess의 updateStatus가
  // next_billing_at을 다음 주기로 다시 채운다. charge가 실패하면
  // handleChargeFailure가 next_billing_at=null로 재확인한다(이미 null이라
  // 실질적으로 no-op). 둘 다 실패하면(partial_failure) next_billing_at이
  // null로 남는데, 이건 claim 도입 전에도 이미 partial_failure가 "자동 복구
  // 안 되는, 사람이 확인해야 하는 상태"였던 것과 동일한 성격이라 새로운
  // 위험을 추가하지 않는다.
  if (!sub.nextBillingAt) {
    // findDueToday 쿼리 자체가 next_billing_at이 있는 것만 반환하므로
    // 이론상 도달 불가능하다 — 그래도 배치가 멈추면 안 되므로 방어적으로 처리.
    console.error(`[billing-service] next_billing_at 없는 청구 대상 — 선점 불가 (subscriptionId=${sub.id})`);
    return { subscriptionId: sub.id, outcome: "error" };
  }
  const claimed = await subscriptionRepository.claimBillingSlot(sub.id, sub.nextBillingAt);
  if (!claimed) {
    // 동시에 겹친 다른 cron 실행이 먼저 이 청구를 가져갔다 — chargeBilling을
    // 호출하지 않고 건너뛴다(이중 청구 방지, 레이스에서 진 쪽).
    console.error(`[billing-service] 청구 슬롯 선점 실패 — 다른 실행이 먼저 처리 중 (subscriptionId=${sub.id})`);
    return { subscriptionId: sub.id, outcome: "error" };
  }

  const paymentMethod = await paymentMethodRepository.findByUserId(sub.userId);
  if (!paymentMethod) {
    // 이론상 도달 불가능한 상태다(PaymentMethod 없이 trial/active Subscription만
    // 있는 경우는 없어야 한다 — startFreeTrial/resubscribe 둘 다 항상 함께
    // 만든다). 그래도 배치가 이 레코드 때문에 멈추면 안 되므로 실패로 기록하고
    // 계속 진행한다.
    console.error(`[billing-service] PaymentMethod 없음 — 청구 불가 (subscriptionId=${sub.id}, userId=${sub.userId})`);
    return { subscriptionId: sub.id, outcome: "error" };
  }

  try {
    const chargeResult = await tossClient.chargeBilling(paymentMethod.billingKey, {
      customerKey: sub.userId,
      amount: sub.amount,
      orderId: crypto.randomUUID(),
      orderName: "동행 AI 코치 구독",
      // claimBillingSlot이 이미 선점한 청구 주기(nextBillingAt)를 그대로 키에
      // 실어, 앱 레벨 락이 뚫리는 미지의 레이스가 있어도 토스 서버가 중복
      // 청구를 한 번 더 막아준다(defense-in-depth, /evolve Researcher 리뷰).
      idempotencyKey: `billing:${sub.id}:${sub.nextBillingAt}`,
    });
    return handleChargeSuccess(sub, chargeResult.paymentKey);
  } catch (err) {
    // (2026-09-16, /evolve Researcher 리뷰) 토스가 구조화된 에러 코드(body.code)를
    // 내려주는데 기존엔 사람이 읽는 메시지만 저장하고 버려졌다 — payment_attempts가
    // 감사(audit) 목적 테이블이라 원인 코드를 조회할 수 있어야 한다.
    const failureReason =
      err instanceof TossApiError && err.tossCode ? `${err.tossCode}: ${err.message}` : (err as Error).message;
    return handleChargeFailure(sub, failureReason);
  }
}

/**
 * ⚠️ 청구는 이미 성공했다(실제 돈이 빠져나갔다) — 여기서부터는 "실패해도 전체를
 * 롤백할 수 없는" 단계다. PaymentAttempt 기록과 Subscription 갱신을 각각
 * 독립된 try/catch로 감싸 하나가 실패해도 다른 하나는 시도한다(예: 감사 기록
 * 실패가 사용자의 실제 접근 권한 갱신을 막으면 안 된다). 최소 하나라도
 * 실패하면 `partial_failure`로 명시적으로 남기고 크게 로그한다 — 실제 청구는
 * 성공했는데 우리 DB가 그 사실을 놓쳤을 수 있는, 자동 복구하지 않는(seed의
 * "past_due 자동 재시도 없음"과 같은 정신) 상태라 사람이 확인해야 한다.
 */
async function handleChargeSuccess(sub: SubscriptionRecord, paymentKey: string): Promise<BillingResultItem> {
  let attemptRecorded = false;
  try {
    await paymentAttemptRepository.create({ subscriptionId: sub.id, result: "success", amount: sub.amount, pgTransactionId: paymentKey });
    attemptRecorded = true;
  } catch (err) {
    console.error(`[billing-service] 청구 성공했지만 PaymentAttempt 기록 실패 (subscriptionId=${sub.id}, paymentKey=${paymentKey})`, err);
  }

  const now = new Date();
  const periodEnd = addBillingPeriod(now, sub.plan);
  let statusUpdated = false;
  try {
    await subscriptionRepository.updateStatus(sub.id, {
      status: "active",
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: periodEnd.toISOString(),
      nextBillingAt: periodEnd.toISOString(),
    });
    statusUpdated = true;
  } catch (err) {
    console.error(`[billing-service] 청구 성공했지만 Subscription 상태 갱신 실패 (subscriptionId=${sub.id}, paymentKey=${paymentKey})`, err);
  }

  if (!attemptRecorded || !statusUpdated) {
    console.error(
      `[billing-service] partial_failure — 실제 청구는 성공했으나 DB 반영 일부 실패 ` +
        `(subscriptionId=${sub.id}, paymentKey=${paymentKey}, attemptRecorded=${attemptRecorded}, statusUpdated=${statusUpdated})`
    );
    return { subscriptionId: sub.id, outcome: "partial_failure" };
  }
  return { subscriptionId: sub.id, outcome: "success" };
}

/**
 * (seed-v3, AC-005) 청구 실패 — 유예기간 없이 즉시 past_due로 전환하고
 * next_billing_at을 null로 비워 자동 재시도 대상에서 뺀다(cron은 past_due를
 * 재시도하지 않는다 — must_not 제약).
 *
 * handleChargeSuccess와 대칭되는 방어(Navigator 리뷰, RETRY 사유) —
 * PaymentAttempt 기록과 status=past_due 전환을 각각 독립 try/catch로 감싸고,
 * 둘 중 하나라도 실패하면 `partial_failure`로 명시한다. **특히
 * updateStatus(past_due)가 실패하는 경우가 위험하다**: 카드 결제는 실제로
 * 거절됐는데 DB의 status는 여전히 trial/active로 남아 checkAICoachAccess가
 * 계속 접근을 허용해버린다 — "차단이 반영되지 않아 결제 안 한 유저가 무료로
 * 계속 이용 가능한 상태"라 성공 경로의 "실제 청구는 성공했으나 DB 반영 실패"
 * 와는 반대 방향으로 위험하다. 이걸 조용히 "failure"(정상 처리된 것처럼)로
 * 남기지 않고 partial_failure로 구분해 사람이 확인하게 한다.
 */
async function handleChargeFailure(sub: SubscriptionRecord, failureReason: string): Promise<BillingResultItem> {
  let attemptRecorded = false;
  try {
    await paymentAttemptRepository.create({ subscriptionId: sub.id, result: "failure", amount: sub.amount, failureReason });
    attemptRecorded = true;
  } catch (err) {
    console.error(`[billing-service] 청구 실패 기록(PaymentAttempt) 자체도 실패 (subscriptionId=${sub.id})`, err);
  }

  let statusUpdated = false;
  try {
    await subscriptionRepository.updateStatus(sub.id, { status: "past_due", nextBillingAt: null });
    statusUpdated = true;
  } catch (err) {
    console.error(`[billing-service] past_due 전환 실패 (subscriptionId=${sub.id})`, err);
  }

  if (!attemptRecorded || !statusUpdated) {
    console.error(
      `[billing-service] partial_failure — 결제는 거절됐으나 DB 반영 일부 실패 ` +
        `(subscriptionId=${sub.id}, failureReason=${failureReason}, attemptRecorded=${attemptRecorded}, statusUpdated=${statusUpdated})` +
        (statusUpdated ? "" : " — ⚠️ status가 past_due로 전환되지 않아 결제 안 한 유저가 계속 접근 가능한 상태일 수 있음")
    );
    return { subscriptionId: sub.id, outcome: "partial_failure" };
  }
  return { subscriptionId: sub.id, outcome: "failure" };
}

export type ExpireOutcome = "success" | "error";

export interface ExpireResultItem {
  subscriptionId: string;
  outcome: ExpireOutcome;
}

/**
 * (seed-v3, AC-007) status='canceled'이고 기간이 지난 Subscription을 expired로
 * 정리한다. checkAICoachAccess(AC-001)가 이미 current_period_end를 직접
 * 비교해 실제 접근 차단은 이 배치 없이도 정확히 동작한다 — 이 배치의 실질
 * 역할은 DB status를 실제 상태와 일치시키는 정리/감사 정확성이다(Navigator
 * Plan A). 그래도 seed가 명시적으로 요구하는 액션이고, 향후 어드민 대시보드가
 * status 필드를 직접 읽게 될 가능성이 있어 방치하지 않는다.
 *
 * 쓰기가 status 갱신 1건뿐이라 runDailyBilling의 partial_failure(2단계 쓰기
 * 중 일부 실패) 구분이 필요 없다 — success/error 2종으로 충분하다. 루프 격리
 * (건별 try/catch)는 동일하게 재사용한다.
 */
export async function expireCanceledSubscriptions(): Promise<ExpireResultItem[]> {
  const targets = await subscriptionRepository.findExpiredCanceled();
  const results: ExpireResultItem[] = [];

  for (const sub of targets) {
    try {
      await subscriptionRepository.updateStatus(sub.id, { status: "expired" });
      results.push({ subscriptionId: sub.id, outcome: "success" });
    } catch (err) {
      console.error(`[billing-service] canceled→expired 전이 실패 (subscriptionId=${sub.id})`, err);
      results.push({ subscriptionId: sub.id, outcome: "error" });
    }
  }

  return results;
}
