import { describe, expect, it, vi, beforeEach } from "vitest";
import { recordHealthLog } from "@/services/health-log-service";
import * as healthLogRepository from "@/lib/data/health-log-repository";
import * as careLinkService from "@/services/care-link-service";
import type { HealthLogRecord } from "@/lib/data/records";

vi.mock("@/lib/data/health-log-repository");
vi.mock("@/services/care-link-service");

const ACTOR = "u-actor";

function record(overrides: Partial<HealthLogRecord>): HealthLogRecord {
  return {
    id: "h1",
    userId: ACTOR,
    loggedByUserId: ACTOR,
    logType: "exercise",
    value: "30분",
    unit: null,
    loggedAt: "2026-09-09T10:00:00Z",
    note: null,
    createdAt: "2026-09-09T10:00:00Z",
    ...overrides,
  };
}

describe("recordHealthLog (AC-005)", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([undefined, ACTOR])("본인 기록 성공 — targetUserId=%s", async (targetUserId) => {
    vi.mocked(healthLogRepository.createHealthLog).mockResolvedValue(record({}));

    const result = await recordHealthLog(ACTOR, {
      targetUserId,
      logType: "exercise",
      value: "30분",
      loggedAt: "2026-09-09T10:00:00Z",
    });

    expect(result.id).toBe("h1");
    expect(healthLogRepository.createHealthLog).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ACTOR, loggedByUserId: ACTOR })
    );
    expect(careLinkService.assertCareLinkAccepted).not.toHaveBeenCalled();
  });

  it("accepted 대리입력 성공 — userId=target, loggedByUserId=actor로 기록된다", async () => {
    vi.mocked(careLinkService.assertCareLinkAccepted).mockResolvedValue(undefined);
    vi.mocked(healthLogRepository.createHealthLog).mockResolvedValue(
      record({ userId: "u-parent", loggedByUserId: ACTOR })
    );

    const result = await recordHealthLog(ACTOR, {
      targetUserId: "u-parent",
      logType: "meal",
      value: "아침 식사",
      loggedAt: "2026-09-09T08:00:00Z",
    });

    expect(result).toBeDefined();
    expect(careLinkService.assertCareLinkAccepted).toHaveBeenCalledWith(ACTOR, "u-parent");
    expect(healthLogRepository.createHealthLog).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u-parent", loggedByUserId: ACTOR })
    );
  });

  it("미승인 대리입력은 거부되고 기록되지 않는다", async () => {
    const guardError = new careLinkService.CareLinkError("NOT_AUTHORIZED", "권한 없음");
    vi.mocked(careLinkService.assertCareLinkAccepted).mockRejectedValue(guardError);

    await expect(
      recordHealthLog(ACTOR, {
        targetUserId: "u-stranger",
        logType: "weight",
        value: "65",
        loggedAt: "2026-09-09T08:00:00Z",
      })
    ).rejects.toBe(guardError);

    expect(healthLogRepository.createHealthLog).not.toHaveBeenCalled();
  });
});
