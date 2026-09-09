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
