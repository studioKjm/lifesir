import { afterEach, describe, expect, it } from "vitest";
import * as healthLogRepository from "@/lib/data/health-log-repository";
import * as userRepository from "@/lib/data/user-repository";
import { createTestAuthUser, deleteTestAuthUser } from "./helpers";
import type { HealthLogType } from "@/types/dto";

const createdIds: string[] = [];
afterEach(async () => {
  while (createdIds.length > 0) {
    const id = createdIds.pop()!;
    await deleteTestAuthUser(id);
  }
});

async function makeUser(prefix: string) {
  const auth = await createTestAuthUser(prefix);
  createdIds.push(auth.id);
  await userRepository.createUser({
    id: auth.id,
    email: auth.email,
    name: prefix,
    birthDate: "1990-01-01",
    agentPersonaId: null,
  });
  return auth.id;
}

const LOG_TYPES: HealthLogType[] = ["exercise", "sleep", "weight", "meal", "medication"];

describe("health-log-repository (통합, 로컬 Supabase)", () => {
  it.each(LOG_TYPES)("%s 타입 기록 생성/조회", async (logType) => {
    const userId = await makeUser(`hl-${logType}`);
    await healthLogRepository.createHealthLog({
      userId,
      loggedByUserId: userId,
      logType,
      value: "10",
      loggedAt: new Date().toISOString(),
    });

    const logs = await healthLogRepository.getLogsForUser(userId, logType);
    expect(logs).toHaveLength(1);
    expect(logs[0].logType).toBe(logType);
  });

  it("getRecentLogsForUser는 최신순으로 limit개만 반환한다", async () => {
    const userId = await makeUser("hl-recent");
    for (let i = 0; i < 5; i++) {
      await healthLogRepository.createHealthLog({
        userId,
        loggedByUserId: userId,
        logType: "weight",
        value: String(60 + i),
        loggedAt: new Date(Date.now() + i * 1000).toISOString(),
      });
    }

    const recent = await healthLogRepository.getRecentLogsForUser(userId, 3);
    expect(recent).toHaveLength(3);
    expect(recent[0].value).toBe("64"); // 가장 최근
  });

  it("logged_by_user_id로 대리입력자를 구분할 수 있다 (AC-005)", async () => {
    const parent = await makeUser("hl-parent");
    const child = await makeUser("hl-child");

    await healthLogRepository.createHealthLog({
      userId: parent,
      loggedByUserId: child,
      logType: "meal",
      value: "아침 식사",
      loggedAt: new Date().toISOString(),
    });

    const logs = await healthLogRepository.getLogsForUser(parent);
    expect(logs[0].userId).toBe(parent);
    expect(logs[0].loggedByUserId).toBe(child);
  });

  it("countAll은 새로 생성한 만큼(최소) 개수가 늘어난다 (T-011, seed-v4 AC-004)", async () => {
    // 다른 테스트 파일이 병렬로 실행되며 전체 카운트에 영향을 줄 수 있어
    // (vitest threads pool) 정확한 델타(+1)가 아니라 최소 +1을 확인한다 —
    // 이 스위트의 다른 통합 테스트들과 동일한 방침(toBeGreaterThanOrEqual).
    const userId = await makeUser("hl-count");
    const before = await healthLogRepository.countAll();

    await healthLogRepository.createHealthLog({
      userId,
      loggedByUserId: userId,
      logType: "weight",
      value: "65",
      loggedAt: new Date().toISOString(),
    });

    const after = await healthLogRepository.countAll();
    expect(after).toBeGreaterThanOrEqual(before + 1);
  });
});
