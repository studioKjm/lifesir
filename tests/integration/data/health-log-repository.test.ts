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
});
