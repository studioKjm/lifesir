// T-012 — 본인 대시보드 집계 (AC-006, low complexity → Direct 구현)
// T-016 — 부모 대시보드 (AC-007, Pair Mode Navigator Plan A)
import * as healthLogRepository from "@/lib/data/health-log-repository";
import { assertCareLinkAccepted } from "@/services/care-link-service";
import type { HealthLogRecord } from "@/lib/data/records";
import type { DailyPointDTO, DashboardSummaryDTO, DashboardViewDTO, HealthLogEntryDTO, HealthLogType } from "@/types/dto";

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

const TREND_DAYS = 7;

// 사용자는 한국 기준으로 "오늘"을 생각하므로 일 단위 구분은 KST로 한다.
const dayKey = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });

function recentDayKeys(now: Date): string[] {
  return Array.from({ length: TREND_DAYS }, (_, i) =>
    dayKey(new Date(now.getTime() - (TREND_DAYS - 1 - i) * 24 * 60 * 60 * 1000))
  );
}

/**
 * 하루치 기록을 하나의 값으로 줄인다. 운동은 그날 합계, 수면·체중은 그날 마지막
 * 기록, 식사·복약은 기록 횟수. value는 "30분"처럼 단위가 붙은 문자열일 수 있어
 * 앞쪽 숫자만 읽고, 숫자가 아닌 기록(예: "완료")은 합계/최신값 계산에서 건너뛴다.
 */
function aggregateDay(logType: HealthLogType, dayEntries: HealthLogEntryDTO[]): number | null {
  if (dayEntries.length === 0) return null;
  if (logType === "meal" || logType === "medication") return dayEntries.length;
  const numbers = dayEntries.map((e) => parseFloat(e.value)).filter((n) => Number.isFinite(n));
  if (numbers.length === 0) return null;
  if (logType === "exercise") return numbers.reduce((a, b) => a + b, 0);
  return numbers[0]; // entries는 logged_at 내림차순이라 첫 값이 그날 마지막 기록
}

function summarize(entries: HealthLogEntryDTO[], now: Date): DashboardSummaryDTO[] {
  const days = recentDayKeys(now);
  const today = days[days.length - 1];
  return ALL_LOG_TYPES.map((logType) => {
    const forType = entries.filter((e) => e.logType === logType);
    const trend: DailyPointDTO[] = days.map((date) => ({
      date,
      value: aggregateDay(logType, forType.filter((e) => dayKey(new Date(e.loggedAt)) === date)),
    }));
    return {
      logType,
      count: forType.length,
      latest: forType[0], // entries는 이미 logged_at 내림차순
      trend,
      loggedToday: forType.some((e) => dayKey(new Date(e.loggedAt)) === today),
    };
  });
}

export async function getOwnDashboard(userId: string, now: Date = new Date()): Promise<DashboardViewDTO> {
  const records = await healthLogRepository.getLogsForUser(userId);
  const entries = records.map(toEntryDTO);
  return { entries, summaryByType: summarize(entries, now) };
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
