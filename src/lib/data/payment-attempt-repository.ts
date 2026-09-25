// T-005 (seed-v3, AC-004, AC-005) — PaymentAttempt 레포지토리.
// cron이 실행하는 정기결제 시도의 성공/실패 감사 기록 전용 — Subscribe/
// Resubscribe 시점의 동기적 결제 실패는 여기 기록하지 않는다(TRD tech_decisions,
// subscription-service.resubscribe 주석 참고). 조회 API는 이번 스코프에 없다
// (감사 기록 목적, create만 필요).
import { getSupabaseClient } from "@/lib/data/supabase-client";
import { RepositoryError } from "@/lib/data/errors";
import type { PaymentAttemptRecord } from "@/lib/data/records";
import type { PaymentAttemptResult } from "@/types/dto";

function toRecord(row: {
  id: string;
  subscription_id: string;
  attempted_at: string;
  result: string;
  amount: number;
  pg_transaction_id: string | null;
  failure_reason: string | null;
}): PaymentAttemptRecord {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    attemptedAt: row.attempted_at,
    result: row.result as PaymentAttemptResult,
    amount: row.amount,
    pgTransactionId: row.pg_transaction_id,
    failureReason: row.failure_reason,
  };
}

export interface CreatePaymentAttemptInput {
  subscriptionId: string;
  result: PaymentAttemptResult;
  amount: number;
  pgTransactionId?: string;
  failureReason?: string;
}

export async function create(input: CreatePaymentAttemptInput): Promise<PaymentAttemptRecord> {
  const { data, error } = await getSupabaseClient()
    .from("payment_attempts")
    .insert({
      subscription_id: input.subscriptionId,
      result: input.result,
      amount: input.amount,
      pg_transaction_id: input.pgTransactionId ?? null,
      failure_reason: input.failureReason ?? null,
    })
    .select("id, subscription_id, attempted_at, result, amount, pg_transaction_id, failure_reason")
    .single();

  if (error) throw new RepositoryError(`PaymentAttempt 기록 실패 (subscriptionId=${input.subscriptionId})`, { cause: error });
  return toRecord(data);
}

/**
 * (seed-v4, T-009, AC-003) 어드민 구독자 상세용 — 한 Subscription에 딸린
 * PaymentAttempt 전체를 시도 시각 오름차순(오래된 것부터)으로 반환한다 —
 * 결제 시도 타임라인을 위→아래로 읽는 자연스러운 순서.
 */
export async function findBySubscriptionId(subscriptionId: string): Promise<PaymentAttemptRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from("payment_attempts")
    .select("id, subscription_id, attempted_at, result, amount, pg_transaction_id, failure_reason")
    .eq("subscription_id", subscriptionId)
    .order("attempted_at", { ascending: true });

  if (error) throw new RepositoryError(`PaymentAttempt 이력 조회 실패 (subscriptionId=${subscriptionId})`, { cause: error });
  return (data ?? []).map(toRecord);
}

/**
 * (seed-v4, T-008, AC-005) 어드민 방치 구독 판정용 — 한 Subscription의 가장
 * 최근 PaymentAttempt 1건. admin-service.classifyStuckSubscription이 이 결과의
 * result로 recoverable/not_recoverable을 가른다(기록 자체가 없으면 undetermined).
 */
export async function findLatestBySubscriptionId(subscriptionId: string): Promise<PaymentAttemptRecord | null> {
  const { data, error } = await getSupabaseClient()
    .from("payment_attempts")
    .select("id, subscription_id, attempted_at, result, amount, pg_transaction_id, failure_reason")
    .eq("subscription_id", subscriptionId)
    .order("attempted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new RepositoryError(`최근 PaymentAttempt 조회 실패 (subscriptionId=${subscriptionId})`, { cause: error });
  return data ? toRecord(data) : null;
}

/**
 * (seed-v4, T-010, AC-001) 기간 내 매출 합계 — result='success'인 attempt의
 * amount만 합산한다(실패/취소 시도는 매출에 포함하지 않음, seed-v4 must).
 * subscription-repository.findDueToday와 동일한 [start, end) 배타적 상한
 * 컨벤션을 쓴다. PostgREST가 SUM 집계를 지원하지 않아 amount 컬럼만 select해
 * 애플리케이션에서 합산한다 — 어드민 전용 저빈도 조회라 규모상 문제없음.
 */
export async function sumSuccessAmountInRange(range: { start: string; end: string }): Promise<number> {
  const { data, error } = await getSupabaseClient()
    .from("payment_attempts")
    .select("amount")
    .eq("result", "success")
    .gte("attempted_at", range.start)
    .lt("attempted_at", range.end);

  if (error) throw new RepositoryError("기간 매출 합계 조회 실패", { cause: error });
  return (data ?? []).reduce((sum, row) => sum + row.amount, 0);
}
