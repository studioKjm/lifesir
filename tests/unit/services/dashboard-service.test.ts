import { describe, expect, it, vi, beforeEach } from "vitest";
import { getOwnDashboard, getParentDashboard } from "@/services/dashboard-service";
import * as healthLogRepository from "@/lib/data/health-log-repository";
import * as careLinkService from "@/services/care-link-service";
import type { HealthLogRecord } from "@/lib/data/records";

vi.mock("@/lib/data/health-log-repository");
vi.mock("@/services/care-link-service");

function record(overrides: Partial<HealthLogRecord>): HealthLogRecord {
  return {
    id: "id",
    userId: "u1",
    loggedByUserId: "u1",
    logType: "exercise",
    value: "10",
    unit: null,
    loggedAt: "2026-09-09T00:00:00Z",
    note: null,
    createdAt: "2026-09-09T00:00:00Z",
    ...overrides,
  };
}

describe("getOwnDashboard", () => {
  beforeEach(() => vi.resetAllMocks());

  it("log_type별로 집계하고 최신 항목을 함께 반환한다", async () => {
    vi.mocked(healthLogRepository.getLogsForUser).mockResolvedValue([
      record({ id: "e1", logType: "exercise", value: "30분", loggedAt: "2026-09-09T10:00:00Z" }),
      record({ id: "e2", logType: "exercise", value: "20분", loggedAt: "2026-09-08T10:00:00Z" }),
      record({ id: "w1", logType: "weight", value: "65", loggedAt: "2026-09-09T09:00:00Z" }),
    ]);

    const dashboard = await getOwnDashboard("u1");

    expect(dashboard.entries).toHaveLength(3);
    const exerciseSummary = dashboard.summaryByType.find((s) => s.logType === "exercise");
    expect(exerciseSummary?.count).toBe(2);
    expect(exerciseSummary?.latest?.id).toBe("e1");
    const medicationSummary = dashboard.summaryByType.find((s) => s.logType === "medication");
    expect(medicationSummary?.count).toBe(0);
    expect(medicationSummary?.latest).toBeUndefined();
  });

  it("기록이 없는 신규 사용자는 빈 entries와 count=0인 5개 요약을 받는다 (AC-010)", async () => {
    vi.mocked(healthLogRepository.getLogsForUser).mockResolvedValue([]);

    const dashboard = await getOwnDashboard("new-user");

    expect(dashboard.entries).toHaveLength(0);
    expect(dashboard.summaryByType).toHaveLength(5);
    expect(dashboard.summaryByType.every((s) => s.count === 0)).toBe(true);
  });
});

describe("getParentDashboard (AC-007)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("accepted 상태면 대상자의 대시보드를 조회해 반환한다", async () => {
    vi.mocked(careLinkService.assertCareLinkAccepted).mockResolvedValue(undefined);
    vi.mocked(healthLogRepository.getLogsForUser).mockResolvedValue([
      record({ id: "e1", logType: "weight", value: "60" }),
    ]);

    const dashboard = await getParentDashboard("u-child", "u-parent");

    expect(careLinkService.assertCareLinkAccepted).toHaveBeenCalledWith("u-child", "u-parent");
    expect(healthLogRepository.getLogsForUser).toHaveBeenCalledWith("u-parent");
    expect(dashboard.entries).toHaveLength(1);
  });

  it("미승인이면 거부되고 HealthLog를 조회하지 않는다", async () => {
    const guardError = new careLinkService.CareLinkError("NOT_AUTHORIZED", "권한 없음");
    vi.mocked(careLinkService.assertCareLinkAccepted).mockRejectedValue(guardError);

    await expect(getParentDashboard("u-stranger", "u-parent")).rejects.toBe(guardError);
    expect(healthLogRepository.getLogsForUser).not.toHaveBeenCalled();
  });
});

describe("getOwnDashboard — 7일 추이", () => {
  beforeEach(() => vi.resetAllMocks());

  // 2026-09-26 12:00 KST
  const NOW = new Date("2026-09-26T03:00:00Z");

  it("최근 7일을 KST 날짜 기준으로 오래된 날부터 채우고, 기록 없는 날은 null이다", async () => {
    vi.mocked(healthLogRepository.getLogsForUser).mockResolvedValue([]);

    const dashboard = await getOwnDashboard("u1", NOW);
    const trend = dashboard.summaryByType.find((s) => s.logType === "sleep")!.trend;

    expect(trend.map((p) => p.date)).toEqual([
      "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26",
    ]);
    expect(trend.every((p) => p.value === null)).toBe(true);
  });

  it("운동은 하루 합계, 체중은 그날 마지막 값, 복약은 횟수로 집계한다", async () => {
    vi.mocked(healthLogRepository.getLogsForUser).mockResolvedValue([
      record({ id: "e1", logType: "exercise", value: "30분", loggedAt: "2026-09-26T01:00:00Z" }),
      record({ id: "e2", logType: "exercise", value: "15", loggedAt: "2026-09-25T23:30:00Z" }), // 9/26 08:30 KST
      record({ id: "w1", logType: "weight", value: "58.2", loggedAt: "2026-09-26T00:30:00Z" }),
      record({ id: "w2", logType: "weight", value: "58.6", loggedAt: "2026-09-25T22:00:00Z" }), // 9/26 07:00 KST
      record({ id: "m1", logType: "medication", value: "완료", loggedAt: "2026-09-25T00:00:00Z" }),
      record({ id: "m2", logType: "medication", value: "완료", loggedAt: "2026-09-24T23:59:00Z" }), // 9/25 KST
    ]);

    const dashboard = await getOwnDashboard("u1", NOW);
    const last = (type: string) => dashboard.summaryByType.find((s) => s.logType === type)!.trend;

    expect(last("exercise").at(-1)?.value).toBe(45);
    expect(last("weight").at(-1)?.value).toBe(58.2);
    expect(last("medication").at(-2)?.value).toBe(2);
    expect(last("medication").at(-1)?.value).toBeNull();
  });

  it("숫자가 아닌 값만 있는 날은 추이 값이 null이지만 오늘 기록 여부는 true다", async () => {
    vi.mocked(healthLogRepository.getLogsForUser).mockResolvedValue([
      record({ id: "e1", logType: "exercise", value: "스트레칭", loggedAt: "2026-09-26T01:00:00Z" }),
    ]);

    const dashboard = await getOwnDashboard("u1", NOW);
    const exercise = dashboard.summaryByType.find((s) => s.logType === "exercise")!;

    expect(exercise.trend.at(-1)?.value).toBeNull();
    expect(exercise.loggedToday).toBe(true);
    expect(dashboard.summaryByType.find((s) => s.logType === "sleep")!.loggedToday).toBe(false);
  });
});
