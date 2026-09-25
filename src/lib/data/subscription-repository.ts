// T-004 (seed-v3, AC-002, AC-001, AC-006, AC-004, AC-007) — Subscription 레포지토리.
import { getSupabaseClient } from "@/lib/data/supabase-client";
import { RepositoryError } from "@/lib/data/errors";
import type { SubscriptionRecord } from "@/lib/data/records";
import type { SubscriptionPlan, SubscriptionStatus } from "@/types/dto";

function toRecord(row: {
  id: string;
  user_id: string;
  plan: string;
  amount: number;
  status: string;
  trial_end_at: string | null;
  current_period_start: string;
  current_period_end: string;
  next_billing_at: string | null;
  canceled_at: string | null;
  created_at: string;
}): SubscriptionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    plan: row.plan as SubscriptionPlan,
    amount: row.amount,
    status: row.status as SubscriptionStatus,
    trialEndAt: row.trial_end_at,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    nextBillingAt: row.next_billing_at,
    canceledAt: row.canceled_at,
    createdAt: row.created_at,
  };
}

export interface CreateSubscriptionInput {
  userId: string;
  plan: SubscriptionPlan;
  amount: number;
  status: SubscriptionStatus;
  trialEndAt: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  nextBillingAt: string | null;
}

export async function create(input: CreateSubscriptionInput): Promise<SubscriptionRecord> {
  const { data, error } = await getSupabaseClient()
    .from("subscriptions")
    .insert({
      user_id: input.userId,
      plan: input.plan,
      amount: input.amount,
      status: input.status,
      trial_end_at: input.trialEndAt,
      current_period_start: input.currentPeriodStart,
      current_period_end: input.currentPeriodEnd,
      next_billing_at: input.nextBillingAt,
    })
    .select(
      "id, user_id, plan, amount, status, trial_end_at, current_period_start, current_period_end, next_billing_at, canceled_at, created_at"
    )
    .single();

  if (error) throw new RepositoryError(`Subscription 생성 실패 (userId=${input.userId})`, { cause: error });
  return toRecord(data);
}

/**
 * (seed-v3, AC-001) 최신 Subscription 1건 — checkAICoachAccess가 접근 판정의
 * 기준으로 삼는다. User는 생애주기 동안 여러 Subscription을 가질 수 있으므로
 * (재구독마다 새 레코드) 반드시 created_at 기준 최신 1건만 봐야 한다.
 */
export async function findLatestByUserId(userId: string): Promise<SubscriptionRecord | null> {
  const { data, error } = await getSupabaseClient()
    .from("subscriptions")
    .select(
      "id, user_id, plan, amount, status, trial_end_at, current_period_start, current_period_end, next_billing_at, canceled_at, created_at"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new RepositoryError(`Subscription 조회 실패 (userId=${userId})`, { cause: error });
  return data ? toRecord(data) : null;
}

/**
 * (seed-v4, AC-006) id로 단건 조회 — 관리자 복구 액션이 서버 측 재검증을 위해
 * 최신 상태를 다시 읽을 때 쓴다.
 */
export async function findById(id: string): Promise<SubscriptionRecord | null> {
  const { data, error } = await getSupabaseClient()
    .from("subscriptions")
    .select(
      "id, user_id, plan, amount, status, trial_end_at, current_period_start, current_period_end, next_billing_at, canceled_at, created_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new RepositoryError(`Subscription 조회 실패 (id=${id})`, { cause: error });
  return data ? toRecord(data) : null;
}

/**
 * (seed-v4, T-005, AC-003) 어드민 구독자 상세용 — 해당 User의 Subscription
 * 전체 이력을 최신순으로 반환한다(재구독마다 새 레코드가 생기는 seed-v3
 * 온톨로지 그대로, 이 이력을 전부 보여주는 게 이 AC의 목적).
 */
export async function findAllByUserId(userId: string): Promise<SubscriptionRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from("subscriptions")
    .select(
      "id, user_id, plan, amount, status, trial_end_at, current_period_start, current_period_end, next_billing_at, canceled_at, created_at"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new RepositoryError(`Subscription 전체 이력 조회 실패 (userId=${userId})`, { cause: error });
  return (data ?? []).map(toRecord);
}

export interface UpdateSubscriptionStatusInput {
  status: SubscriptionStatus;
  canceledAt?: string | null;
  nextBillingAt?: string | null;
  // seed-v3, AC-004 — runDailyBilling이 청구 성공 시 다음 결제 주기를 반영하려면
  // 이 두 필드도 갱신해야 한다. AC-006(해지)은 여전히 이 필드들을 절대 건드리지
  // 않는다 — cancelSubscription은 이 옵션들을 넘기지 않으므로 undefined로 남아
  // patch에서 자동으로 빠진다(아래 구현 참고).
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
}

/**
 * (seed-v3, AC-006, AC-004) 상태 전이 전용. status/canceledAt/nextBillingAt은
 * 기본으로 다루고, currentPeriodStart/End는 호출부가 명시적으로 넘길 때만
 * 갱신한다 — 이 필드들을 함부로 건드리면 checkAICoachAccess의 해지 유예 판정이
 * 조용히 깨진다(Navigator 리뷰, AC-006 라운드). cancelSubscription은 여전히
 * 이 두 필드를 넘기지 않아 기존 값이 그대로 보존된다.
 */
export async function updateStatus(id: string, input: UpdateSubscriptionStatusInput): Promise<SubscriptionRecord> {
  const patch: {
    status: SubscriptionStatus;
    canceled_at?: string | null;
    next_billing_at?: string | null;
    current_period_start?: string;
    current_period_end?: string;
  } = {
    status: input.status,
  };
  if (input.canceledAt !== undefined) patch.canceled_at = input.canceledAt;
  if (input.nextBillingAt !== undefined) patch.next_billing_at = input.nextBillingAt;
  if (input.currentPeriodStart !== undefined) patch.current_period_start = input.currentPeriodStart;
  if (input.currentPeriodEnd !== undefined) patch.current_period_end = input.currentPeriodEnd;

  const { data, error } = await getSupabaseClient()
    .from("subscriptions")
    .update(patch)
    .eq("id", id)
    .select(
      "id, user_id, plan, amount, status, trial_end_at, current_period_start, current_period_end, next_billing_at, canceled_at, created_at"
    )
    .single();

  if (error) throw new RepositoryError(`Subscription 상태 갱신 실패 (id=${id})`, { cause: error });
  return toRecord(data);
}

/**
 * (seed-v3, AC-004) 오늘 청구 대상 — status가 trial 또는 active이고
 * next_billing_at이 "오늘"(UTC 00:00~다음날 00:00) 범위인 Subscription 전체.
 *
 * ⚠️ 의도적으로 정확한 날짜 범위만 매치한다(`next_billing_at &lt;= 오늘`처럼
 * 밀린 것까지 잡는 캐치업 쿼리가 아니다) — Subscription 갱신이 실패해
 * next_billing_at이 갱신 안 된 채 남으면, 캐치업 쿼리는 다음날 같은 레코드를
 * 다시 집어 토스에 또 청구를 시도한다(AC-008에서 막은 것과 같은 클래스의
 * 이중 청구 위험). 정확 매치는 그 레코드가 다음날 조건에서 자동으로 빠지게
 * 해 "조용히 두 번 청구"보다 "막힌 채로 사람이 확인해야 함"을 택한다
 * (Navigator Plan A).
 */
export async function findDueToday(): Promise<SubscriptionRecord[]> {
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  const { data, error } = await getSupabaseClient()
    .from("subscriptions")
    .select(
      "id, user_id, plan, amount, status, trial_end_at, current_period_start, current_period_end, next_billing_at, canceled_at, created_at"
    )
    .in("status", ["trial", "active"])
    .gte("next_billing_at", todayStart.toISOString())
    .lt("next_billing_at", tomorrowStart.toISOString());

  if (error) throw new RepositoryError("오늘 청구 대상 Subscription 조회 실패", { cause: error });
  return (data ?? []).map(toRecord);
}

/**
 * (seed-v3, AC-004) 청구 슬롯을 조건부로 선점한다 — 반드시 WHERE
 * next_billing_at=expectedNextBillingAt까지 걸어서 Postgres UPDATE의 원자성을
 * 락처럼 쓴다. markPastDueAsExpired(AC-008)와 정확히 같은 계열의 방어다.
 *
 * ⚠️ 독립 Test Designer의 blind 설계 리뷰 중 발견(2026-09-16) — runDailyBilling이
 * chargeBilling 호출 전에 아무 선점 없이 findDueToday 결과를 그대로 썼다.
 * /api/cron/billing이 겹쳐 호출되면(예: docs/toss-payments-setup.md가 안내하는
 * 수동 curl 확인이 실제 스케줄 실행과 겹치는 경우) 두 호출 다 findDueToday에서
 * 같은 레코드를 읽어 둘 다 chargeBilling을 호출할 수 있었다 — AC-008에서 이미
 * 한 번 잡은 것과 완전히 같은 클래스의 이중 청구 위험이 이 경로에만 남아있었다.
 */
export async function claimBillingSlot(id: string, expectedNextBillingAt: string): Promise<boolean> {
  const { data, error } = await getSupabaseClient()
    .from("subscriptions")
    .update({ next_billing_at: null })
    .eq("id", id)
    .eq("next_billing_at", expectedNextBillingAt)
    .select("id");

  if (error) throw new RepositoryError(`청구 슬롯 선점 실패 (id=${id})`, { cause: error });
  return (data?.length ?? 0) > 0;
}

/**
 * (seed-v3, AC-008) past_due 레코드를 expired로 조건부 전이한다 — 반드시
 * WHERE status='past_due'까지 걸어서 Postgres의 단일 UPDATE 원자성을 락처럼
 * 쓴다. 동시에 두 재구독 요청이 들어와도 이 조건에 실제로 걸리는(영향받는)
 * 건 하나뿐이다 — 먼저 통과한 쪽이 status를 바꿔버리므로 늦게 도착한 쪽은
 * 이 UPDATE의 WHERE에 더 이상 안 걸린다. 영향받은 행이 있었는지(true/false)를
 * 반환해 호출부(resubscribe)가 "내가 이겼는지"를 판정하게 한다 — 이걸로
 * chargeBilling 호출 전에 이중 청구 레이스를 막는다(Navigator 리뷰, RETRY 사유).
 */
export async function markPastDueAsExpired(id: string): Promise<boolean> {
  const { data, error } = await getSupabaseClient()
    .from("subscriptions")
    .update({ status: "expired" })
    .eq("id", id)
    .eq("status", "past_due")
    .select("id");

  if (error) throw new RepositoryError(`Subscription past_due→expired 전이 실패 (id=${id})`, { cause: error });
  return (data?.length ?? 0) > 0;
}

/**
 * (seed-v3, AC-007) status='canceled'이고 current_period_end가 지난
 * Subscription 전체 — expireCanceledSubscriptions가 status를 expired로
 * 정리할 대상이다.
 *
 * findDueToday(AC-004)와 달리 캐치업 쿼리(`&lt;`, 밀린 것도 전부 포함)를 쓴다 —
 * 이 배치는 외부 부수효과(토스 결제 호출)가 전혀 없는 순수 내부 상태 전이라
 * 이중 청구 같은 위험이 없고, 조건 자체가 `status='canceled'`라 성공적으로
 * expired로 바뀌는 순간 다음 조회에서 자동으로 빠진다(자기소거) — 갱신이
 * 하루 실패해도 다음날 다시 집혀 재시도되는 게 오히려 바람직하다(자가 치유,
 * Navigator Plan A).
 */
const ALL_STATUSES: SubscriptionStatus[] = ["trial", "active", "canceled", "past_due", "expired"];

/**
 * (seed-v4, T-003, AC-001) 어드민 대시보드용 상태별 구독자 수 — "현재" 스냅샷
 * 이라 기간과 무관하다(AC 문구 "현재 구독자 수"). PostgREST가 GROUP BY를
 * 지원하지 않아 상태 5개를 각각 head-count 쿼리로 병렬 조회한다 —
 * findDuplicateActiveGroups와 동일한 이유(어드민 전용 저빈도 조회, 규모상 문제없음).
 */
export async function countByStatus(): Promise<Record<SubscriptionStatus, number>> {
  const counts = await Promise.all(
    ALL_STATUSES.map(async (status) => {
      const { count, error } = await getSupabaseClient()
        .from("subscriptions")
        .select("*", { count: "exact", head: true })
        .eq("status", status);
      if (error) throw new RepositoryError(`상태별 Subscription 개수 조회 실패 (status=${status})`, { cause: error });
      return [status, count ?? 0] as const;
    })
  );
  return Object.fromEntries(counts) as Record<SubscriptionStatus, number>;
}

export interface SubscriberListItem {
  userId: string;
  email: string;
  name: string;
  status: SubscriptionStatus;
  plan: SubscriptionPlan;
  currentPeriodEnd: string;
}

export interface SearchSubscribersQuery {
  search?: string;
  status?: SubscriptionStatus;
  page?: number;
}

export interface SearchSubscribersResult {
  items: SubscriberListItem[];
  page: number;
  pageSize: number;
  totalCount: number;
}

const SUBSCRIBERS_PAGE_SIZE = 20;

/**
 * (seed-v4, T-004, AC-002) 어드민 구독자 검색/목록 — ontology의 "User + 각자의
 * 최신 Subscription 상태 목록"을 그대로 구현한다. `users!inner(...)` embedded
 * select라 Subscription이 하나도 없는 User는 결과에서 자동으로 빠진다("구독자
 * 목록"은 구독 레코드가 있는 User만을 뜻한다는 해석, Navigator Plan A).
 *
 * PostgREST가 "user_id별 최신 1건"(group-by-latest)을 지원하지 않아, 검색어로
 * 좁혀진 후보 전체를 fetch한 뒤 애플리케이션에서 user_id별 최신(created_at) 1건만
 * 남기고, status 필터는 그 최신 건에만 적용한다(과거 이력이 아니라 "현재 상태"로
 * 필터링하는 게 AC 의도) — countByStatus/findDuplicateActiveGroups와 동일한
 * "어드민 전용 저빈도 조회는 전체 fetch 후 앱코드 집계" 전제를 재사용한다.
 */
export async function searchSubscribers(query: SearchSubscribersQuery = {}): Promise<SearchSubscribersResult> {
  let request = getSupabaseClient()
    .from("subscriptions")
    .select("id, user_id, plan, status, current_period_end, created_at, users!inner(email, name)");

  if (query.search) {
    const term = query.search.replace(/[%,]/g, "");
    request = request.or(`email.ilike.%${term}%,name.ilike.%${term}%`, { foreignTable: "users" });
  }

  const { data, error } = await request;
  if (error) throw new RepositoryError("구독자 검색 실패", { cause: error });

  type Row = {
    id: string;
    user_id: string;
    plan: SubscriptionPlan;
    status: SubscriptionStatus;
    current_period_end: string;
    created_at: string;
    users: { email: string; name: string } | { email: string; name: string }[];
  };

  const latestByUser = new Map<string, Row>();
  for (const row of (data ?? []) as Row[]) {
    const existing = latestByUser.get(row.user_id);
    if (!existing || row.created_at > existing.created_at) {
      latestByUser.set(row.user_id, row);
    }
  }

  let items: SubscriberListItem[] = [...latestByUser.values()]
    .filter((row) => !query.status || row.status === query.status)
    .map((row) => {
      const userInfo = Array.isArray(row.users) ? row.users[0] : row.users;
      return {
        userId: row.user_id,
        email: userInfo.email,
        name: userInfo.name,
        status: row.status,
        plan: row.plan,
        currentPeriodEnd: row.current_period_end,
      };
    })
    .sort((a, b) => a.email.localeCompare(b.email));

  const totalCount = items.length;
  const page = Math.max(1, query.page ?? 1);
  const startIndex = (page - 1) * SUBSCRIBERS_PAGE_SIZE;
  items = items.slice(startIndex, startIndex + SUBSCRIBERS_PAGE_SIZE);

  return { items, page, pageSize: SUBSCRIBERS_PAGE_SIZE, totalCount };
}

export interface DuplicateActiveGroup {
  userId: string;
  subscriptions: SubscriptionRecord[];
}

/**
 * (seed-v4, AC-007) 동시에 유효한(trial/active/past_due) Subscription을 2건
 * 이상 가진 User를 찾는다 — seed-v3 invariant("한 User가 동시에 두 개 이상의
 * 유효한 Subscription을 갖지 않는다")가 코드 수준에서 아직 완전히 강제되지
 * 않는 잔여 갭(/evolve ADR-003)을 관측하기 위한 조회다. 조회만 하고 교정하지
 * 않는다(seed-v4 must).
 *
 * PostgREST는 GROUP BY를 직접 지원하지 않아, 후보 전체를 가져와 애플리케이션
 * 코드에서 user_id로 묶는다 — 어드민 전용 저빈도 조회라 규모상 문제되지 않는다.
 */
export async function findDuplicateActiveGroups(): Promise<DuplicateActiveGroup[]> {
  const { data, error } = await getSupabaseClient()
    .from("subscriptions")
    .select(
      "id, user_id, plan, amount, status, trial_end_at, current_period_start, current_period_end, next_billing_at, canceled_at, created_at"
    )
    .in("status", ["trial", "active", "past_due"]);

  if (error) throw new RepositoryError("중복 유효 Subscription 조회 실패", { cause: error });

  const byUser = new Map<string, SubscriptionRecord[]>();
  for (const row of data ?? []) {
    const record = toRecord(row);
    const list = byUser.get(record.userId) ?? [];
    list.push(record);
    byUser.set(record.userId, list);
  }
  return [...byUser.entries()]
    .filter(([, subs]) => subs.length > 1)
    .map(([userId, subscriptions]) => ({ userId, subscriptions }));
}

/**
 * (seed-v4, T-006, AC-005) partial_failure로 방치된 것으로 추정되는 Subscription
 * 후보 — status가 trial/active인데 next_billing_at이 null이고(claimBillingSlot이
 * 선점 후 charge 결과 반영에 실패한 흔적, seed-v3 billing-service 참고)
 * current_period_end가 이미 지난 건. 이 후보들이 실제로 복구 가능한지(A클래스:
 * 결제 성공)/불가능한지(B클래스: 결제 실패)/판단 불가한지는 이 쿼리만으로는
 * 알 수 없다 — admin-service.classifyStuckSubscription이 각 후보의 가장 최근
 * PaymentAttempt.result를 별도로 조회해 재해석한다.
 */
export async function findStuckCandidates(): Promise<SubscriptionRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from("subscriptions")
    .select(
      "id, user_id, plan, amount, status, trial_end_at, current_period_start, current_period_end, next_billing_at, canceled_at, created_at"
    )
    .in("status", ["trial", "active"])
    .is("next_billing_at", null)
    .lt("current_period_end", new Date().toISOString());

  if (error) throw new RepositoryError("방치 의심 Subscription 후보 조회 실패", { cause: error });
  return (data ?? []).map(toRecord);
}

export async function findExpiredCanceled(): Promise<SubscriptionRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from("subscriptions")
    .select(
      "id, user_id, plan, amount, status, trial_end_at, current_period_start, current_period_end, next_billing_at, canceled_at, created_at"
    )
    .eq("status", "canceled")
    .lt("current_period_end", new Date().toISOString());

  if (error) throw new RepositoryError("만료 처리 대상 Subscription 조회 실패", { cause: error });
  return (data ?? []).map(toRecord);
}
