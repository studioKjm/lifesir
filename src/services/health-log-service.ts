// T-015 — HealthLog 기록 (AC-005, 본인/대리입력)
// Pair Mode(Navigator Plan A)로 설계됨.
import * as healthLogRepository from "@/lib/data/health-log-repository";
import { assertCareLinkAccepted } from "@/services/care-link-service";
import type { HealthLogRecord } from "@/lib/data/records";
import type { HealthLogEntryDTO, HealthLogInput } from "@/types/dto";

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

/**
 * targetUserId가 없거나 actorId와 같으면 본인 기록. 다르면 대리입력이므로
 * assertCareLinkAccepted(actorId, targetUserId)로 권한을 확인한다 — 실패 시
 * CareLinkError를 그대로 전파한다(Logic 레이어 도메인 에러라 변환 불필요).
 */
export async function recordHealthLog(actorId: string, input: HealthLogInput): Promise<HealthLogEntryDTO> {
  const targetUserId = input.targetUserId ?? actorId;

  if (targetUserId !== actorId) {
    await assertCareLinkAccepted(actorId, targetUserId);
  }

  const record = await healthLogRepository.createHealthLog({
    userId: targetUserId,
    loggedByUserId: actorId,
    logType: input.logType,
    value: input.value,
    unit: input.unit,
    loggedAt: input.loggedAt,
    note: input.note,
  });

  return toEntryDTO(record);
}
