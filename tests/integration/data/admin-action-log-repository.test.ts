import { afterEach, describe, expect, it } from "vitest";
import * as adminActionLogRepository from "@/lib/data/admin-action-log-repository";
import * as subscriptionRepository from "@/lib/data/subscription-repository";
import * as userRepository from "@/lib/data/user-repository";
import { createTestAuthUser, deleteTestAuthUser } from "./helpers";

const createdIds: string[] = [];
afterEach(async () => {
  while (createdIds.length > 0) {
    const id = createdIds.pop()!;
    await deleteTestAuthUser(id);
  }
});

async function createTestSubscription(prefix: string) {
  const auth = await createTestAuthUser(prefix);
  createdIds.push(auth.id);
  await userRepository.createUser({ id: auth.id, email: auth.email, name: "테스트 사용자", agentPersonaId: null });
  const now = new Date().toISOString();
  const sub = await subscriptionRepository.create({
    userId: auth.id,
    plan: "monthly",
    amount: 9900,
    status: "trial",
    trialEndAt: null,
    currentPeriodStart: now,
    currentPeriodEnd: now,
    nextBillingAt: now,
  });
  return { admin: auth, sub };
}

describe("admin-action-log-repository (통합, 로컬 Supabase)", () => {
  it("정상적으로 감사 기록을 생성할 수 있다 (T-002, seed-v4 AC-006)", async () => {
    const { admin, sub } = await createTestSubscription("aal-create");

    const log = await adminActionLogRepository.create({
      adminUserId: admin.id,
      subscriptionId: sub.id,
      actionType: "recover_partial_failure",
      previousStatus: "trial",
      newStatus: "active",
    });

    expect(log.actionType).toBe("recover_partial_failure");
    expect(log.previousStatus).toBe("trial");
    expect(log.newStatus).toBe("active");
    expect(log.subscriptionId).toBe(sub.id);
    expect(log.adminUserId).toBe(admin.id);
  });

  it("존재하지 않는 subscriptionId로는 FK 제약(on delete restrict) 위반으로 실패한다", async () => {
    const { admin } = await createTestSubscription("aal-fk-sub");

    await expect(
      adminActionLogRepository.create({
        adminUserId: admin.id,
        subscriptionId: "00000000-0000-0000-0000-000000000000",
        actionType: "recover_partial_failure",
        previousStatus: "trial",
        newStatus: "active",
      })
    ).rejects.toThrow();
  });

  it("존재하지 않는 adminUserId로는 FK 제약 위반으로 실패한다", async () => {
    const { sub } = await createTestSubscription("aal-fk-admin");

    await expect(
      adminActionLogRepository.create({
        adminUserId: "00000000-0000-0000-0000-000000000000",
        subscriptionId: sub.id,
        actionType: "recover_partial_failure",
        previousStatus: "trial",
        newStatus: "active",
      })
    ).rejects.toThrow();
  });
});
