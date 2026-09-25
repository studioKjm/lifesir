// T-003 (seed-v3, AC-002, AC-003) — PaymentMethod 레포지토리.
// user_id UNIQUE 제약이 "무료체험은 User당 평생 1회" 불변식의 최종 방어선이다.
import { getSupabaseClient } from "@/lib/data/supabase-client";
import { RepositoryError, DuplicatePaymentMethodError } from "@/lib/data/errors";
import type { PaymentMethodRecord } from "@/lib/data/records";

function toRecord(row: {
  id: string;
  user_id: string;
  billing_key: string;
  card_last4: string;
  registered_at: string;
}): PaymentMethodRecord {
  return {
    id: row.id,
    userId: row.user_id,
    billingKey: row.billing_key,
    cardLast4: row.card_last4,
    registeredAt: row.registered_at,
  };
}

export interface CreatePaymentMethodInput {
  userId: string;
  billingKey: string;
  cardLast4: string;
}

export async function create(input: CreatePaymentMethodInput): Promise<PaymentMethodRecord> {
  const { data, error } = await getSupabaseClient()
    .from("payment_methods")
    .insert({ user_id: input.userId, billing_key: input.billingKey, card_last4: input.cardLast4 })
    .select("id, user_id, billing_key, card_last4, registered_at")
    .single();

  if (error) {
    // seed-v3, AC-003 — 이 제약(payment_methods_user_id_key) 위반은 동시 요청이
    // "무료체험 평생 1회" 불변식을 뚫으려 한 것으로 본다.
    if (error.code === "23505" && error.message.includes("payment_methods_user_id_key")) {
      throw new DuplicatePaymentMethodError(input.userId, { cause: error });
    }
    throw new RepositoryError(`PaymentMethod 생성 실패 (userId=${input.userId})`, { cause: error });
  }
  return toRecord(data);
}

export async function findByUserId(userId: string): Promise<PaymentMethodRecord | null> {
  const { data, error } = await getSupabaseClient()
    .from("payment_methods")
    .select("id, user_id, billing_key, card_last4, registered_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new RepositoryError(`PaymentMethod 조회 실패 (userId=${userId})`, { cause: error });
  return data ? toRecord(data) : null;
}

/**
 * 롤백 전용 — startFreeTrial이 PaymentMethod 생성 후 Subscription 생성에
 * 실패했을 때, "카드는 등록됐는데 구독 이력이 전혀 없는" 영구 락 상태를
 * 막기 위해 방금 만든 PaymentMethod를 되돌린다(Navigator Plan A).
 */
export async function deleteByUserId(userId: string): Promise<void> {
  const { error } = await getSupabaseClient().from("payment_methods").delete().eq("user_id", userId);
  if (error) throw new RepositoryError(`PaymentMethod 롤백 삭제 실패 (userId=${userId})`, { cause: error });
}
