import { afterEach, describe, expect, it } from "vitest";
import * as paymentAttemptRepository from "@/lib/data/payment-attempt-repository";
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
  return subscriptionRepository.create({
    userId: auth.id,
    plan: "monthly",
    amount: 9900,
    status: "active",
    trialEndAt: null,
    currentPeriodStart: now,
    currentPeriodEnd: now,
    nextBillingAt: now,
  });
}

describe("payment-attempt-repository (통합, 로컬 Supabase)", () => {
  it("success 결과를 pgTransactionId와 함께 기록할 수 있다", async () => {
    const sub = await createTestSubscription("pa-success");

    const attempt = await paymentAttemptRepository.create({
      subscriptionId: sub.id,
      result: "success",
      amount: 9900,
      pgTransactionId: "pay_abc123",
    });

    expect(attempt.result).toBe("success");
    expect(attempt.pgTransactionId).toBe("pay_abc123");
    expect(attempt.failureReason).toBeNull();
  });

  it("failure 결과를 failureReason과 함께 기록할 수 있다", async () => {
    const sub = await createTestSubscription("pa-failure");

    const attempt = await paymentAttemptRepository.create({
      subscriptionId: sub.id,
      result: "failure",
      amount: 9900,
      failureReason: "카드 한도초과",
    });

    expect(attempt.result).toBe("failure");
    expect(attempt.pgTransactionId).toBeNull();
    expect(attempt.failureReason).toBe("카드 한도초과");
  });

  it("존재하지 않는 subscriptionId로는 FK 제약 위반으로 실패한다", async () => {
    await expect(
      paymentAttemptRepository.create({
        subscriptionId: "00000000-0000-0000-0000-000000000000",
        result: "success",
        amount: 9900,
      })
    ).rejects.toThrow();
  });

  it("findBySubscriptionId — 여러 시도 건을 시도 시각 오름차순으로 전체 반환한다 (T-009, seed-v4 AC-003)", async () => {
    const sub = await createTestSubscription("pa-find-by-sub");
    await paymentAttemptRepository.create({ subscriptionId: sub.id, result: "failure", amount: 9900, failureReason: "한도초과" });
    await paymentAttemptRepository.create({ subscriptionId: sub.id, result: "success", amount: 9900 });

    const all = await paymentAttemptRepository.findBySubscriptionId(sub.id);

    expect(all).toHaveLength(2);
    expect(all[0].attemptedAt <= all[1].attemptedAt).toBe(true);
    expect(all.map((a) => a.result)).toEqual(["failure", "success"]);
  });

  it("findBySubscriptionId — 시도 기록이 없으면 빈 배열을 반환한다 (T-009, seed-v4 AC-003)", async () => {
    const sub = await createTestSubscription("pa-find-by-sub-empty");

    const all = await paymentAttemptRepository.findBySubscriptionId(sub.id);

    expect(all).toEqual([]);
  });

  it("findLatestBySubscriptionId — 여러 시도 중 가장 최근 1건만 반환한다 (T-008, seed-v4 AC-005)", async () => {
    const sub = await createTestSubscription("pa-latest");
    await paymentAttemptRepository.create({ subscriptionId: sub.id, result: "failure", amount: 9900, failureReason: "1차 실패" });
    const latest = await paymentAttemptRepository.create({ subscriptionId: sub.id, result: "success", amount: 9900 });

    const found = await paymentAttemptRepository.findLatestBySubscriptionId(sub.id);

    expect(found?.id).toBe(latest.id);
    expect(found?.result).toBe("success");
  });

  it("findLatestBySubscriptionId — 시도 기록이 없으면 null을 반환한다 (T-008, seed-v4 AC-005)", async () => {
    const sub = await createTestSubscription("pa-latest-none");

    const found = await paymentAttemptRepository.findLatestBySubscriptionId(sub.id);

    expect(found).toBeNull();
  });

  it("sumSuccessAmountInRange — 범위 밖(과거) 조회는 최근 생성분을 포함하지 않는다 (T-010, seed-v4 AC-001)", async () => {
    const sub = await createTestSubscription("pa-range-out");
    await paymentAttemptRepository.create({ subscriptionId: sub.id, result: "success", amount: 9900 });

    // attempted_at은 항상 now()로 기록되므로, 서기 2000년 범위는 방금 만든
    // 기록을 절대 포함할 수 없다 — 병렬 실행 중인 다른 테스트 데이터와도
    // 무관하게 안전한 경계 확인.
    const sum = await paymentAttemptRepository.sumSuccessAmountInRange({
      start: "2000-01-01T00:00:00.000Z",
      end: "2000-01-02T00:00:00.000Z",
    });

    expect(sum).toBe(0);
  });

  it("sumSuccessAmountInRange — 현재 시점을 포함하는 범위는 방금 생성한 success 금액을 합산하고 failure는 제외한다 (T-010, seed-v4 AC-001)", async () => {
    const sub = await createTestSubscription("pa-range-in");
    const before = new Date(Date.now() - 60_000).toISOString();

    await paymentAttemptRepository.create({ subscriptionId: sub.id, result: "success", amount: 12345 });
    // 다른 병렬 테스트의 정상 금액(9900/99000류)과 확실히 구분되는 매우 큰
    // 금액으로 failure를 만들어, "이 금액이 합계에 섞이지 않았는지"를 다른
    // 테스트의 동시 실행과 무관하게 확인한다.
    await paymentAttemptRepository.create({ subscriptionId: sub.id, result: "failure", amount: 999_999_999 });

    const after = new Date(Date.now() + 60_000).toISOString();
    const sum = await paymentAttemptRepository.sumSuccessAmountInRange({ start: before, end: after });

    expect(sum).toBeGreaterThanOrEqual(12345);
    expect(sum).toBeLessThan(999_999_999);
  });
});
