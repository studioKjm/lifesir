// T-012 — 본인 대시보드 집계 (AC-006, low complexity → Direct 구현)
// T-016 — 부모 대시보드 (AC-007, Pair Mode Navigator Plan A)
import * as healthLogRepository from "@/lib/data/health-log-repository";
import { assertCareLinkAccepted } from "@/services/care-link-service";
import type { HealthLogRecord } from "@/lib/data/records";
import type { DashboardSummaryDTO, DashboardViewDTO, HealthLogEntryDTO, HealthLogType } from "@/types/dto";

const ALL_LOG_TYPES: HealthLogType[] = ["exercise", "sleep", "weight", "meal", "medication"];

function toEntryDTO(record: HealthLogRecord): HealthLogEntryDTO {
  return {
    id: record.id,
    logType: record.logType,
    value: record.value,
    unit: record.unit ?? undefined,
    loggedAt: record.loggedAt,
    note: record.note ?? undefined,
    loggedByUserId: record.loggedByUserId,
  };
}

function summarize(entries: HealthLogEntryDTO[]): DashboardSummaryDTO[] {
  return ALL_LOG_TYPES.map((logType) => {
    const forType = entries.filter((e) => e.logType === logType);
    return {
      logType,
      count: forType.length,
      latest: forType[0], // entries는 이미 logged_at 내림차순
    };
  });
}

export async function getOwnDashboard(userId: string): Promise<DashboardViewDTO> {
  const records = await healthLogRepository.getLogsForUser(userId);
  const entries = records.map(toEntryDTO);
  return { entries, summaryByType: summarize(entries) };
}

/**
 * 자녀(actorId)가 부모(targetUserId)의 대시보드를 읽기 전용으로 조회한다 (AC-007).
 * 권한 판정은 assertCareLinkAccepted 단 하나의 경로로만 하고(가드 로직 중복 금지 —
 * AC-004에서 중복으로 인한 방향성 버그를 겪은 바 있음), 통과하면 getOwnDashboard의
 * 집계 로직을 그대로 재사용한다.
 */
export async function getParentDashboard(actorId: string, targetUserId: string): Promise<DashboardViewDTO> {
  await assertCareLinkAccepted(actorId, targetUserId);
  return getOwnDashboard(targetUserId);
}
