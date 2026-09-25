// T-002 (seed-v4, AC-006) — AdminActionLog 레포지토리.
// 관리자의 유일한 쓰기 액션(구독 복구)에 대한 append-only 감사 기록. 조회 API는
// 이번 스코프에 없다(감사 기록 목적, create만 필요 — payment-attempt-repository와
// 동일한 선례). 레코드를 수정·삭제하는 함수도 두지 않는다(append-only).
import { getSupabaseClient } from "@/lib/data/supabase-client";
import { RepositoryError } from "@/lib/data/errors";
import type { AdminActionLogRecord } from "@/lib/data/records";
import type { AdminActionType, SubscriptionStatus } from "@/types/dto";

function toRecord(row: {
  id: string;
  admin_user_id: string;
  subscription_id: string;
  action_type: string;
  previous_status: string;
  new_status: string;
  performed_at: string;
}): AdminActionLogRecord {
  return {
    id: row.id,
    adminUserId: row.admin_user_id,
    subscriptionId: row.subscription_id,
    actionType: row.action_type as AdminActionType,
    previousStatus: row.previous_status as SubscriptionStatus,
    newStatus: row.new_status as SubscriptionStatus,
    performedAt: row.performed_at,
  };
}

export interface CreateAdminActionLogInput {
  adminUserId: string;
  subscriptionId: string;
  actionType: AdminActionType;
  previousStatus: SubscriptionStatus;
  newStatus: SubscriptionStatus;
}

export async function create(input: CreateAdminActionLogInput): Promise<AdminActionLogRecord> {
  const { data, error } = await getSupabaseClient()
    .from("admin_action_logs")
    .insert({
      admin_user_id: input.adminUserId,
      subscription_id: input.subscriptionId,
      action_type: input.actionType,
      previous_status: input.previousStatus,
      new_status: input.newStatus,
    })
    .select("id, admin_user_id, subscription_id, action_type, previous_status, new_status, performed_at")
    .single();

  if (error) throw new RepositoryError(`AdminActionLog 기록 실패 (subscriptionId=${input.subscriptionId})`, { cause: error });
  return toRecord(data);
}
