// T-007 — HealthLog 레포지토리 (AC-005)
import { getSupabaseClient } from "@/lib/data/supabase-client";
import { RepositoryError } from "@/lib/data/errors";
import type { HealthLogRecord } from "@/lib/data/records";
import type { HealthLogType } from "@/types/dto";

function toRecord(row: {
  id: string;
  user_id: string;
  logged_by_user_id: string;
  log_type: HealthLogType;
  value: string;
  unit: string | null;
  logged_at: string;
  note: string | null;
  created_at: string;
}): HealthLogRecord {
  return {
    id: row.id,
    userId: row.user_id,
    loggedByUserId: row.logged_by_user_id,
    logType: row.log_type,
    value: row.value,
    unit: row.unit,
    loggedAt: row.logged_at,
    note: row.note,
    createdAt: row.created_at,
  };
}

const COLUMNS = "id, user_id, logged_by_user_id, log_type, value, unit, logged_at, note, created_at";

export interface CreateHealthLogInput {
  userId: string;
  loggedByUserId: string;
  logType: HealthLogType;
  value: string;
  unit?: string;
  loggedAt: string;
  note?: string;
}

export async function createHealthLog(input: CreateHealthLogInput): Promise<HealthLogRecord> {
  const { data, error } = await getSupabaseClient()
    .from("health_logs")
    .insert({
      user_id: input.userId,
      logged_by_user_id: input.loggedByUserId,
      log_type: input.logType,
      value: input.value,
      unit: input.unit ?? null,
      logged_at: input.loggedAt,
      note: input.note ?? null,
    })
    .select(COLUMNS)
    .single();

  if (error) throw new RepositoryError(`HealthLog 생성 실패 (userId=${input.userId})`, { cause: error });
  return toRecord(data);
}

export async function getLogsForUser(userId: string, logType?: HealthLogType): Promise<HealthLogRecord[]> {
  let query = getSupabaseClient()
    .from("health_logs")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("logged_at", { ascending: false });

  if (logType) query = query.eq("log_type", logType);

  const { data, error } = await query;
  if (error) throw new RepositoryError(`HealthLog 조회 실패 (userId=${userId})`, { cause: error });
  return (data ?? []).map(toRecord);
}

/** AI 에이전트 컨텍스트용 — 최근 N건. */
export async function getRecentLogsForUser(userId: string, limit: number): Promise<HealthLogRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from("health_logs")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("logged_at", { ascending: false })
    .limit(limit);

  if (error) throw new RepositoryError(`최근 HealthLog 조회 실패 (userId=${userId})`, { cause: error });
  return (data ?? []).map(toRecord);
}

/** T-011 (seed-v4, AC-004) — 어드민 대시보드 서비스 통계용 전체 개수. */
export async function countAll(): Promise<number> {
  const { count, error } = await getSupabaseClient()
    .from("health_logs")
    .select("*", { count: "exact", head: true });

  if (error) throw new RepositoryError("HealthLog 전체 개수 조회 실패", { cause: error });
  return count ?? 0;
}
