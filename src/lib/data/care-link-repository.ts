// T-006 — CareLink 레포지토리 (AC-003, AC-004)
import { getSupabaseClient } from "@/lib/data/supabase-client";
import { RepositoryError } from "@/lib/data/errors";
import type { CareLinkRecord } from "@/lib/data/records";
import type { CareLinkStatus } from "@/types/dto";

function toRecord(row: {
  id: string;
  requester_user_id: string;
  target_user_id: string;
  status: CareLinkStatus;
  consent_confirmed_at: string | null;
  created_at: string;
}): CareLinkRecord {
  return {
    id: row.id,
    requesterUserId: row.requester_user_id,
    targetUserId: row.target_user_id,
    status: row.status,
    consentConfirmedAt: row.consent_confirmed_at,
    createdAt: row.created_at,
  };
}

const COLUMNS = "id, requester_user_id, target_user_id, status, consent_confirmed_at, created_at";

export async function create(requesterUserId: string, targetUserId: string): Promise<CareLinkRecord> {
  const { data, error } = await getSupabaseClient()
    .from("care_links")
    .insert({ requester_user_id: requesterUserId, target_user_id: targetUserId, status: "pending" })
    .select(COLUMNS)
    .single();

  if (error) throw new RepositoryError("CareLink 생성 실패", { cause: error });
  return toRecord(data);
}

export async function updateStatus(id: string, status: CareLinkStatus): Promise<CareLinkRecord> {
  const { data, error } = await getSupabaseClient()
    .from("care_links")
    .update({
      status,
      consent_confirmed_at: status === "accepted" ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .select(COLUMNS)
    .single();

  if (error) throw new RepositoryError(`CareLink 상태 갱신 실패 (id=${id})`, { cause: error });
  return toRecord(data);
}

export async function getById(id: string): Promise<CareLinkRecord | null> {
  const { data, error } = await getSupabaseClient()
    .from("care_links")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new RepositoryError(`CareLink 조회 실패 (id=${id})`, { cause: error });
  return data ? toRecord(data) : null;
}

/** actorId와 targetId 사이의 관계(방향 무관)를 조회한다. AC-004 권한 가드가 사용. */
export async function findBetween(userIdA: string, userIdB: string): Promise<CareLinkRecord | null> {
  const { data, error } = await getSupabaseClient()
    .from("care_links")
    .select(COLUMNS)
    .or(
      `and(requester_user_id.eq.${userIdA},target_user_id.eq.${userIdB}),and(requester_user_id.eq.${userIdB},target_user_id.eq.${userIdA})`
    )
    .maybeSingle();

  if (error) throw new RepositoryError("CareLink 관계 조회 실패", { cause: error });
  return data ? toRecord(data) : null;
}

/** T-020 — care-links 페이지 목록용. 내가 요청자든 대상자든(방향 무관) 관련된 모든 CareLink를 반환한다. */
export async function getAllForUser(userId: string): Promise<CareLinkRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from("care_links")
    .select(COLUMNS)
    .or(`requester_user_id.eq.${userId},target_user_id.eq.${userId}`)
    .order("created_at", { ascending: false });

  if (error) throw new RepositoryError(`CareLink 목록 조회 실패 (userId=${userId})`, { cause: error });
  return (data ?? []).map(toRecord);
}

export async function getPendingForUser(targetUserId: string): Promise<CareLinkRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from("care_links")
    .select(COLUMNS)
    .eq("target_user_id", targetUserId)
    .eq("status", "pending");

  if (error) throw new RepositoryError(`대기중 CareLink 조회 실패 (targetUserId=${targetUserId})`, { cause: error });
  return (data ?? []).map(toRecord);
}

/** T-012 (seed-v4, AC-004) — 어드민 대시보드 서비스 통계용 상태별 개수. */
export async function countByStatus(status: CareLinkStatus): Promise<number> {
  const { count, error } = await getSupabaseClient()
    .from("care_links")
    .select("*", { count: "exact", head: true })
    .eq("status", status);

  if (error) throw new RepositoryError(`CareLink 개수 조회 실패 (status=${status})`, { cause: error });
  return count ?? 0;
}
