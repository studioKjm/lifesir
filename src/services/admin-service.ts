// T-015, T-021 (seed-v4, AC-004, AC-007) — 어드민 대시보드 Logic 레이어.
// low complexity AC(AC-004, AC-007)는 /run Direct Deliver로 작성됨 — 나머지
// medium/high AC 함수는 Pair Mode(Navigator) 라운드에서 이어서 추가된다.
import * as userRepository from "@/lib/data/user-repository";
import * as healthLogRepository from "@/lib/data/health-log-repository";
import * as careLinkRepository from "@/lib/data/care-link-repository";
import * as subscriptionRepository from "@/lib/data/subscription-repository";
import * as paymentAttemptRepository from "@/lib/data/payment-attempt-repository";
import * as adminActionLogRepository from "@/lib/data/admin-action-log-repository";
import { addBillingPeriod } from "@/services/subscription-service";
import type {
  DuplicateActiveGroup,
  SearchSubscribersQuery,
  SearchSubscribersResult,
} from "@/lib/data/subscription-repository";
import type { SubscriptionRecord, PaymentAttemptRecord } from "@/lib/data/records";
import type { SubscriptionStatus } from "@/types/dto";

export type AdminErrorCode = "NOT_RECOVERABLE" | "SUBSCRIPTION_NOT_FOUND";

export class AdminError extends Error {
  code: AdminErrorCode;
  constructor(code: AdminErrorCode, message: string) {
    super(message);
    this.name = "AdminError";
    this.code = code;
  }
}

/**
 * (seed-v4, AC-008) 관리자 판정 — User.email과 서버 전용 환경변수 ADMIN_EMAIL을
 * 런타임에 비교하는 것으로만 이루어진다(순수 함수, 대소문자 정규화 없이 정확
 * 일치만 인정한다). env 미설정 시 항상 false로 fail-closed 처리한다 —
 * seed-v3 CRON_SECRET(timingSafeEqual, 시크릿 미설정 시 항상 거부)과 동일한
 * 원칙. User 엔티티에 role/is_admin 필드를 추가하지 않는다(seed-v4 must_not).
 *
 * ⚠️ 공유 게이트 헬퍼(예: requireAdminPage())를 두지 않는다 — src/proxy.ts는
 * 로그인 여부만 확인하고(matcher에 /admin/:path* 포함, DB 조회 금지 제약),
 * "로그인은 했지만 관리자가 아님" 판정은 각 admin 페이지/Server Action이
 * getSession() 직후 이 함수를 직접 호출해 재확인해야 한다(defense-in-depth) —
 * seed-v3의 `src/app/chat/page.tsx` + `src/app/api/chat/route.ts` 선례와
 * 동일한 패턴(Navigator Plan A, AC-008). 아직 caller가 없는 상태에서 redirect
 * 대상/에러 포맷을 미리 확정하는 공용 헬퍼는 다음 라운드(AC-001 등)에서
 * 요구가 어긋나면 바로 뜯어고쳐야 하는 추측성 유연성이라 배제했다.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !email) return false;
  return email === adminEmail;
}

export interface RevenueSummaryView {
  statusCounts: Record<SubscriptionStatus, number>;
  revenueTotal: number;
}

/**
 * (seed-v4, AC-001) 상태별 구독자 수(항상, 기간 무관) + 기간 매출 합계(range가
 * 있을 때만). range를 안 주면 sumSuccessAmountInRange를 아예 호출하지 않고
 * revenueTotal=0을 반환한다 — 이 계약이 unit test로 고정되어 있다.
 */
export async function getRevenueSummary(range?: { start: string; end: string }): Promise<RevenueSummaryView> {
  const [statusCounts, revenueTotal] = await Promise.all([
    subscriptionRepository.countByStatus(),
    range ? paymentAttemptRepository.sumSuccessAmountInRange(range) : Promise.resolve(0),
  ]);
  return { statusCounts, revenueTotal };
}

/**
 * (seed-v4, AC-002) 구독자 검색/목록 — searchSubscribers에 그대로 위임한다
 * (검색/필터/페이지네이션 자체는 Data 레이어 쿼리 책임, T-017 설계).
 */
export async function listSubscribers(query: SearchSubscribersQuery = {}): Promise<SearchSubscribersResult> {
  return subscriptionRepository.searchSubscribers(query);
}

export interface SubscriberDetailView {
  user: { id: string; email: string; name: string };
  subscriptions: (SubscriptionRecord & { paymentAttempts: PaymentAttemptRecord[] })[];
}

/**
 * (seed-v4, AC-003) 구독자 상세 — User의 Subscription 전체 이력 + 각 Subscription에
 * 딸린 PaymentAttempt 전체. User 자체가 없으면(오타/삭제된 유저) null을 반환해
 * "진짜 없음"을 알린다 — 구독 이력이 0건인 것(가입만 하고 구독을 시작 안 한
 * 정상 상태)과는 구분한다(subscriptions: []는 null이 아니다). PaymentMethod는
 * 이 화면에서 조회하지 않는다 — seed ontology의 output 계약에 없고, billing_key/
 * 카드 원본 정보 노출 금지(seed-v4 must)를 가장 안전하게 지키는 방법은 아예
 * 쿼리하지 않는 것이다.
 */
export async function getSubscriberDetail(userId: string): Promise<SubscriberDetailView | null> {
  const user = await userRepository.getUserById(userId);
  if (!user) return null;

  const subscriptions = await subscriptionRepository.findAllByUserId(userId);
  const withAttempts = await Promise.all(
    subscriptions.map(async (sub) => ({
      ...sub,
      paymentAttempts: await paymentAttemptRepository.findBySubscriptionId(sub.id),
    }))
  );

  return { user: { id: user.id, email: user.email, name: user.name }, subscriptions: withAttempts };
}

export interface ServiceStatsView {
  userCount: number;
  healthLogCount: number;
  activeCareLinkCount: number;
}

/**
 * (seed-v4, AC-004) 서비스 전체 집계 — 가입자 수, 총 HealthLog 수, 활성(accepted)
 * CareLink 수. 개별 유저 드릴다운은 이번 스코프에 없다(seed-v4 non_goals).
 */
export async function getServiceStats(): Promise<ServiceStatsView> {
  const [userCount, healthLogCount, activeCareLinkCount] = await Promise.all([
    userRepository.countAll(),
    healthLogRepository.countAll(),
    careLinkRepository.countByStatus("accepted"),
  ]);
  return { userCount, healthLogCount, activeCareLinkCount };
}

export type StuckClassification = "recoverable" | "not_recoverable" | "undetermined";

/**
 * (seed-v4, AC-005, AC-006) 방치 구독 판정 — 순수 함수. `latestAttempt`가 실제로
 * "이 subscription의 가장 최근 PaymentAttempt"라는 게 계약이다(호출부가 반드시
 * paymentAttemptRepository.findLatestBySubscriptionId(sub.id)의 결과를 그대로
 * 넘겨야 한다) — 이 함수 자신은 latestAttempt.subscriptionId가 sub.id와
 * 일치하는지 검증하지 않는다(순수 함수, 입력을 신뢰). 다른 subscription의
 * 오래된 성공 기록을 잘못 넘기면 오분류된다 — 이건 코드가 아니라 호출 규율로
 * 지켜야 하는 계약이다(detectStuckSubscriptions와 recoverStuckSubscription
 * 양쪽이 이 계약을 지키며 이 함수를 공유한다, seed invariant: "매 조회 시점마다
 * 재계산").
 *
 * - latestAttempt가 없음(그 subscription에 대한 시도 기록 자체가 없음) → undetermined
 * - latestAttempt.result === "success" → recoverable (실제 결제 성공, 복구해도 안전)
 * - latestAttempt.result === "failure" → not_recoverable (실제 결제 거절, 복구하면 결제 안 한 유저에게 무료 접근을 주게 됨)
 */
export function classifyStuckSubscription(
  sub: SubscriptionRecord,
  latestAttempt: PaymentAttemptRecord | null
): StuckClassification {
  if (!latestAttempt) return "undetermined";
  return latestAttempt.result === "success" ? "recoverable" : "not_recoverable";
}

export interface StuckSubscriptionView {
  subscription: SubscriptionRecord;
  classification: StuckClassification;
}

/**
 * (seed-v4, AC-005) 방치 의심 Subscription 목록 — 각 후보의 가장 최근
 * PaymentAttempt를 조회해 classifyStuckSubscription으로 분류한다. 조회
 * 전용(side effect 없음) — 어떤 상태도 바꾸지 않는다.
 */
export async function detectStuckSubscriptions(): Promise<StuckSubscriptionView[]> {
  const candidates = await subscriptionRepository.findStuckCandidates();
  return Promise.all(
    candidates.map(async (subscription) => {
      const latestAttempt = await paymentAttemptRepository.findLatestBySubscriptionId(subscription.id);
      return { subscription, classification: classifyStuckSubscription(subscription, latestAttempt) };
    })
  );
}

/**
 * (seed-v4, AC-006) subscription-repository.findStuckCandidates()의 SQL WHERE를
 * 앱코드에 그대로 미러링한 순수 함수 — recoverStuckSubscription의 서버
 * 재검증이 "이 subscription이 지금도 구조적으로 방치 상태인지"를 다시 확인할
 * 때 쓴다.
 *
 * ⚠️ classifyStuckSubscription만 재실행하는 것으로는 부족하다(Navigator 리뷰로
 * 발견) — classifyStuckSubscription은 "최근 결제 시도가 성공인지"만 보고
 * "애초에 방치 상태인지"는 안 본다. 정상적으로 active인(최근 결제도 성공한)
 * 구독의 id를 관리자가 API로 직접 찔러도 classifyStuckSubscription만으로는
 * "recoverable"이 나와버려, 무료로 한 주기를 더 연장해주는 통로가 된다 —
 * seed must_not("판정 없이 임의로 active 전환 금지")을 좁은 해석으로 우회하게
 * 되는 셈이다. 그래서 recoverStuckSubscription은 이 함수와 classifyStuckSubscription
 * **둘 다** 통과해야만 복구를 진행한다.
 *
 * ⚠️ 이 조건은 subscriptionRepository.findStuckCandidates()의 SQL과 반드시
 * 동기화해야 한다 — 한쪽만 바뀌면 조용히 어긋난다.
 */
export function isStuckCandidate(sub: SubscriptionRecord, now: Date = new Date()): boolean {
  return (
    (sub.status === "trial" || sub.status === "active") &&
    sub.nextBillingAt === null &&
    new Date(sub.currentPeriodEnd) < now
  );
}

export type RecoverOutcome = "recovered" | "recovered_log_failed";

export interface RecoverStuckSubscriptionResult {
  outcome: RecoverOutcome;
  subscription: SubscriptionRecord;
}

/**
 * (seed-v4, AC-006) 유일한 쓰기 액션 — recoverable로 표시된 Subscription을
 * status=active + 정상 다음 결제 주기로 복구하고 AdminActionLog에 기록한다.
 *
 * 서버 재검증: 대상을 다시 조회해 isStuckCandidate(구조적으로 아직 방치
 * 상태인지) AND classifyStuckSubscription(...)==="recoverable"(실제 결제 성공
 * 확인) 둘 다 통과해야 진행한다 — 클라이언트가 무엇을 주장하든 신뢰하지 않는다
 * (UI 우회/직접 API 호출 포함 차단).
 *
 * TOCTOU 레이스 방어(조건부 UPDATE 등)를 의도적으로 두지 않는다 — 이 액션은
 * (1) 실제 결제 API를 호출하지 않는 순수 내부 상태 전이라 최악의 경우도 감사
 * 로그 중복/시각 오차 정도로 금전 위험이 없고, (2) 관리자는 정의상 1명뿐이며
 * (seed non_goal: 역할 세분화 없음), (3) next_billing_at이 null인 동안은
 * findDueToday(cron 청구 대상)에 절대 걸리지 않아 cron과의 레이스가 구조적으로
 * 불가능하다 — 실제로 존재하지 않는 위험에 락을 거는 건 과잉 방어다. 같은
 * 탭에서의 실수 더블클릭만 Presentation의 pending-disable로 막는다.
 *
 * Subscription 갱신 → 성공 시에만 AdminActionLog 기록(순서 고정, 진짜 트랜잭션
 * 불가능한 PostgREST 제약 — seed-v3 /evolve ADR-003과 동일 원칙). 로그 기록만
 * 실패하면 상태 변경 자체는 유효한 것으로 보고 `recovered_log_failed`를 반환한다.
 */
export async function recoverStuckSubscription(
  adminUserId: string,
  subscriptionId: string
): Promise<RecoverStuckSubscriptionResult> {
  const sub = await subscriptionRepository.findById(subscriptionId);
  if (!sub) throw new AdminError("SUBSCRIPTION_NOT_FOUND", `Subscription을 찾을 수 없습니다 (id=${subscriptionId})`);

  const latestAttempt = await paymentAttemptRepository.findLatestBySubscriptionId(subscriptionId);
  const recoverable = isStuckCandidate(sub) && classifyStuckSubscription(sub, latestAttempt) === "recoverable";
  if (!recoverable) {
    throw new AdminError("NOT_RECOVERABLE", `복구할 수 없는 상태입니다 (id=${subscriptionId})`);
  }

  const now = new Date();
  const periodEnd = addBillingPeriod(now, sub.plan);
  const updated = await subscriptionRepository.updateStatus(subscriptionId, {
    status: "active",
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: periodEnd.toISOString(),
    nextBillingAt: periodEnd.toISOString(),
  });

  try {
    await adminActionLogRepository.create({
      adminUserId,
      subscriptionId,
      actionType: "recover_partial_failure",
      previousStatus: sub.status,
      newStatus: "active",
    });
  } catch (err) {
    console.error(
      `[admin-service] 구독은 복구됐지만 AdminActionLog 기록 실패 (subscriptionId=${subscriptionId}, adminUserId=${adminUserId})`,
      err
    );
    return { outcome: "recovered_log_failed", subscription: updated };
  }

  return { outcome: "recovered", subscription: updated };
}

/**
 * (seed-v4, AC-007) 동시에 유효한(trial/active/past_due) Subscription을 2건
 * 이상 가진 User 목록 — 조회 전용, 교정 기능 없음(seed-v4 must, scope.future).
 */
export async function detectDuplicateActiveSubscriptions(): Promise<DuplicateActiveGroup[]> {
  return subscriptionRepository.findDuplicateActiveGroups();
}
