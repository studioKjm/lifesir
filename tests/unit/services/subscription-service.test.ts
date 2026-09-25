import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  startFreeTrial,
  checkAICoachAccess,
  cancelSubscription,
  resubscribe,
  addBillingPeriod,
  getSubscriptionStatus,
  SubscriptionError,
} from "@/services/subscription-service";
import * as paymentMethodRepository from "@/lib/data/payment-method-repository";
import * as subscriptionRepository from "@/lib/data/subscription-repository";
import * as tossClient from "@/lib/data/toss-client";
import { DuplicatePaymentMethodError, RepositoryError } from "@/lib/data/errors";
import type { PaymentMethodRecord, SubscriptionRecord } from "@/lib/data/records";

vi.mock("@/lib/data/payment-method-repository");
vi.mock("@/lib/data/subscription-repository");
vi.mock("@/lib/data/toss-client");

function paymentMethod(overrides: Partial<PaymentMethodRecord> = {}): PaymentMethodRecord {
  return {
    id: "pm-1",
    userId: "u-1",
    billingKey: "billing-key",
    cardLast4: "1234",
    registeredAt: "2026-09-15T00:00:00Z",
    ...overrides,
  };
}

function subscription(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    id: "sub-1",
    userId: "u-1",
    plan: "monthly",
    amount: 9900,
    status: "trial",
    trialEndAt: "2026-09-22T00:00:00Z",
    currentPeriodStart: "2026-09-15T00:00:00Z",
    currentPeriodEnd: "2026-09-22T00:00:00Z",
    nextBillingAt: "2026-09-22T00:00:00Z",
    canceledAt: null,
    createdAt: "2026-09-15T00:00:00Z",
    ...overrides,
  };
}

describe("subscription-service.startFreeTrial (AC-002, AC-003)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("성공: PaymentMethod 없음 → 빌링키 발급 → PaymentMethod+Subscription(trial) 생성", async () => {
    vi.mocked(paymentMethodRepository.findByUserId).mockResolvedValue(null);
    vi.mocked(tossClient.issueBillingKey).mockResolvedValue({ billingKey: "bk-1", cardLast4: "1234" });
    vi.mocked(paymentMethodRepository.create).mockResolvedValue(paymentMethod());
    vi.mocked(subscriptionRepository.create).mockResolvedValue(subscription());

    const result = await startFreeTrial("u-1", "monthly", "auth-key");

    expect(result.subscription.status).toBe("trial");
    expect(subscriptionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u-1", plan: "monthly", amount: 9900, status: "trial" })
    );
  });

  it("PAYMENT_METHOD_ALREADY_EXISTS: 사전 확인에서 이미 존재 → 토스 호출 자체가 일어나지 않는다 (AC-003)", async () => {
    vi.mocked(paymentMethodRepository.findByUserId).mockResolvedValue(paymentMethod());

    await expect(startFreeTrial("u-1", "monthly", "auth-key")).rejects.toMatchObject({
      code: "PAYMENT_METHOD_ALREADY_EXISTS",
    });
    expect(tossClient.issueBillingKey).not.toHaveBeenCalled();
  });

  it("PAYMENT_METHOD_ALREADY_EXISTS: 사전 확인은 통과했지만 레이스로 DB insert가 거부됨 (AC-003 동시성)", async () => {
    vi.mocked(paymentMethodRepository.findByUserId).mockResolvedValue(null);
    vi.mocked(tossClient.issueBillingKey).mockResolvedValue({ billingKey: "bk-1", cardLast4: "1234" });
    vi.mocked(paymentMethodRepository.create).mockRejectedValue(new DuplicatePaymentMethodError("u-1"));

    await expect(startFreeTrial("u-1", "monthly", "auth-key")).rejects.toMatchObject({
      code: "PAYMENT_METHOD_ALREADY_EXISTS",
    });
    expect(subscriptionRepository.create).not.toHaveBeenCalled();
  });

  it("BILLING_KEY_ISSUE_FAILED: 토스 API 실패 시 DB에 아무 것도 안 남는다", async () => {
    vi.mocked(paymentMethodRepository.findByUserId).mockResolvedValue(null);
    vi.mocked(tossClient.issueBillingKey).mockRejectedValue(new Error("invalid authKey"));

    await expect(startFreeTrial("u-1", "monthly", "auth-key")).rejects.toMatchObject({
      code: "BILLING_KEY_ISSUE_FAILED",
    });
    expect(paymentMethodRepository.create).not.toHaveBeenCalled();
  });

  it("SUBSCRIPTION_CREATE_FAILED: Subscription 생성 실패 시 PaymentMethod를 롤백(삭제)한다", async () => {
    vi.mocked(paymentMethodRepository.findByUserId).mockResolvedValue(null);
    vi.mocked(tossClient.issueBillingKey).mockResolvedValue({ billingKey: "bk-1", cardLast4: "1234" });
    vi.mocked(paymentMethodRepository.create).mockResolvedValue(paymentMethod());
    vi.mocked(subscriptionRepository.create).mockRejectedValue(new RepositoryError("DB 장애"));

    await expect(startFreeTrial("u-1", "monthly", "auth-key")).rejects.toMatchObject({
      code: "SUBSCRIPTION_CREATE_FAILED",
    });
    expect(paymentMethodRepository.deleteByUserId).toHaveBeenCalledWith("u-1");
  });
});

describe("subscription-service.checkAICoachAccess (AC-001)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("구독 이력 없음 → 차단(blocked:no_subscription)", async () => {
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(null);

    const result = await checkAICoachAccess("u-1");

    expect(result).toEqual({ allowed: false, reason: "blocked:no_subscription" });
  });

  it("trial → 허용(trial_active)", async () => {
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(subscription({ status: "trial" }));

    expect(await checkAICoachAccess("u-1")).toEqual({ allowed: true, reason: "trial_active" });
  });

  it("active → 허용(paid_active)", async () => {
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(subscription({ status: "active" }));

    expect(await checkAICoachAccess("u-1")).toEqual({ allowed: true, reason: "paid_active" });
  });

  it("canceled + current_period_end가 아직 안 지남 → 허용(grace_until_period_end, 해지 유예)", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(
      subscription({ status: "canceled", currentPeriodEnd: future })
    );

    expect(await checkAICoachAccess("u-1")).toEqual({ allowed: true, reason: "grace_until_period_end" });
  });

  it("canceled + current_period_end가 지남 → 차단(blocked:expired, cron 미실행 구간이어도 정확히 판정)", async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(
      subscription({ status: "canceled", currentPeriodEnd: past })
    );

    expect(await checkAICoachAccess("u-1")).toEqual({ allowed: false, reason: "blocked:expired" });
  });

  it("past_due → 유예 없이 즉시 차단(blocked:past_due)", async () => {
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(subscription({ status: "past_due" }));

    expect(await checkAICoachAccess("u-1")).toEqual({ allowed: false, reason: "blocked:past_due" });
  });

  it("expired → 차단(blocked:expired)", async () => {
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(subscription({ status: "expired" }));

    expect(await checkAICoachAccess("u-1")).toEqual({ allowed: false, reason: "blocked:expired" });
  });
});

describe("subscription-service.cancelSubscription (AC-006)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("trial 상태 → 해지 성공, status=canceled + canceledAt 기록 + nextBillingAt=null", async () => {
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(subscription({ status: "trial" }));
    vi.mocked(subscriptionRepository.updateStatus).mockResolvedValue(subscription({ status: "canceled" }));

    await cancelSubscription("u-1");

    expect(subscriptionRepository.updateStatus).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ status: "canceled", nextBillingAt: null })
    );
    const call = vi.mocked(subscriptionRepository.updateStatus).mock.calls[0][1];
    expect(call.canceledAt).toEqual(expect.any(String));
  });

  it("active 상태 → 해지 성공", async () => {
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(subscription({ status: "active" }));
    vi.mocked(subscriptionRepository.updateStatus).mockResolvedValue(subscription({ status: "canceled" }));

    await expect(cancelSubscription("u-1")).resolves.not.toThrow();
  });

  it("이미 canceled인 구독 재해지 시도 → NO_CANCELABLE_SUBSCRIPTION (더블클릭 방어)", async () => {
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(subscription({ status: "canceled" }));

    await expect(cancelSubscription("u-1")).rejects.toMatchObject({ code: "NO_CANCELABLE_SUBSCRIPTION" });
    expect(subscriptionRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("past_due 상태는 해지 대상이 아니다 → NO_CANCELABLE_SUBSCRIPTION", async () => {
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(subscription({ status: "past_due" }));

    await expect(cancelSubscription("u-1")).rejects.toMatchObject({ code: "NO_CANCELABLE_SUBSCRIPTION" });
  });

  it("구독 이력 자체가 없음 → NO_CANCELABLE_SUBSCRIPTION", async () => {
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(null);

    await expect(cancelSubscription("u-1")).rejects.toMatchObject({ code: "NO_CANCELABLE_SUBSCRIPTION" });
  });
});


describe("subscription-service.addBillingPeriod (AC-008, AC-004)", () => {
  it("monthly — 일반적인 날짜는 그냥 한 달 뒤가 된다", () => {
    const result = addBillingPeriod(new Date(2026, 2, 15), "monthly"); // 2026-03-15
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(3); // 4월(0-indexed)
    expect(result.getDate()).toBe(15);
  });

  it("monthly — 1월 31일 + 1개월은 3월로 넘어가지 않고 2월 마지막 날(28일, 평년)로 clamp된다", () => {
    const result = addBillingPeriod(new Date(2026, 0, 31), "monthly"); // 2026-01-31 (2026은 평년)
    expect(result.getMonth()).toBe(1); // 2월
    expect(result.getDate()).toBe(28);
  });

  it("monthly — 1월 31일 + 1개월, 대상 연도가 윤년이면 2월 29일로 clamp된다", () => {
    const result = addBillingPeriod(new Date(2028, 0, 31), "monthly"); // 2028은 윤년
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(29);
  });

  it("yearly — 일반적인 날짜는 그냥 1년 뒤가 된다", () => {
    const result = addBillingPeriod(new Date(2026, 5, 10), "yearly");
    expect(result.getFullYear()).toBe(2027);
    expect(result.getMonth()).toBe(5);
    expect(result.getDate()).toBe(10);
  });

  it("yearly — 윤년 2월 29일 + 1년, 다음 해가 평년이면 2월 28일로 clamp된다", () => {
    const result = addBillingPeriod(new Date(2028, 1, 29), "yearly"); // 2028-02-29
    expect(result.getFullYear()).toBe(2029);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(28);
  });
});

describe("subscription-service.resubscribe (AC-008)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("NO_PAYMENT_METHOD: 등록된 결제수단이 없으면 재구독 불가", async () => {
    vi.mocked(paymentMethodRepository.findByUserId).mockResolvedValue(null);

    await expect(resubscribe("u-1", "monthly")).rejects.toMatchObject({ code: "NO_PAYMENT_METHOD" });
    expect(tossClient.chargeBilling).not.toHaveBeenCalled();
  });

  it("SUBSCRIPTION_ALREADY_ACTIVE: trial/active 구독이 이미 있으면 재구독 불가", async () => {
    vi.mocked(paymentMethodRepository.findByUserId).mockResolvedValue(paymentMethod());
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(subscription({ status: "active" }));

    await expect(resubscribe("u-1", "monthly")).rejects.toMatchObject({ code: "SUBSCRIPTION_ALREADY_ACTIVE" });
  });

  it("SUBSCRIPTION_ALREADY_ACTIVE: canceled + 유예 중(current_period_end 안 지남)이면 재구독 불가", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(paymentMethodRepository.findByUserId).mockResolvedValue(paymentMethod());
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(
      subscription({ status: "canceled", currentPeriodEnd: future })
    );

    await expect(resubscribe("u-1", "monthly")).rejects.toMatchObject({ code: "SUBSCRIPTION_ALREADY_ACTIVE" });
  });

  it("성공: canceled + 기간 종료 → 즉시 청구 후 trial 단계 없이 status=active로 시작", async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(paymentMethodRepository.findByUserId).mockResolvedValue(paymentMethod({ billingKey: "bk-1" }));
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(
      subscription({ status: "canceled", currentPeriodEnd: past })
    );
    vi.mocked(tossClient.chargeBilling).mockResolvedValue({ paymentKey: "pay-1", approvedAt: "2026-09-16T00:00:00Z" });
    vi.mocked(subscriptionRepository.create).mockResolvedValue(subscription({ status: "active", trialEndAt: null }));

    const result = await resubscribe("u-1", "monthly");

    expect(result.status).toBe("active");
    expect(tossClient.chargeBilling).toHaveBeenCalledWith("bk-1", expect.objectContaining({ customerKey: "u-1", amount: 9900 }));
    expect(subscriptionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u-1", plan: "monthly", status: "active", trialEndAt: null })
    );
  });

  it("이중 청구 방어(defense-in-depth): canceled+기간종료 기원 재구독은 DB 락이 없어 하루 단위 고정 Idempotency-Key를 chargeBilling에 전달한다 (/evolve Contrarian·Researcher 리뷰)", async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(paymentMethodRepository.findByUserId).mockResolvedValue(paymentMethod({ billingKey: "bk-1" }));
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(
      subscription({ status: "canceled", currentPeriodEnd: past })
    );
    vi.mocked(tossClient.chargeBilling).mockResolvedValue({ paymentKey: "pay-1", approvedAt: "2026-09-16T00:00:00Z" });
    vi.mocked(subscriptionRepository.create).mockResolvedValue(subscription({ status: "active", trialEndAt: null }));

    await resubscribe("u-1", "monthly");

    expect(tossClient.chargeBilling).toHaveBeenCalledWith(
      "bk-1",
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^resubscribe:u-1:\d{4}-\d{2}-\d{2}$/) })
    );
  });

  it("성공: past_due → 레코드를 expired로 선점한 뒤 재구독 가능", async () => {
    vi.mocked(paymentMethodRepository.findByUserId).mockResolvedValue(paymentMethod({ billingKey: "bk-1" }));
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(subscription({ status: "past_due", id: "sub-old" }));
    vi.mocked(subscriptionRepository.markPastDueAsExpired).mockResolvedValue(true);
    vi.mocked(tossClient.chargeBilling).mockResolvedValue({ paymentKey: "pay-1", approvedAt: "2026-09-16T00:00:00Z" });
    vi.mocked(subscriptionRepository.create).mockResolvedValue(subscription({ status: "active", trialEndAt: null }));

    await expect(resubscribe("u-1", "yearly")).resolves.toMatchObject({ status: "active" });
    expect(subscriptionRepository.markPastDueAsExpired).toHaveBeenCalledWith("sub-old");
  });

  it("SUBSCRIPTION_ALREADY_ACTIVE (이중 청구 방지): past_due 선점 레이스에서 진 요청은 chargeBilling을 호출하지 않는다", async () => {
    vi.mocked(paymentMethodRepository.findByUserId).mockResolvedValue(paymentMethod({ billingKey: "bk-1" }));
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(subscription({ status: "past_due", id: "sub-old" }));
    vi.mocked(subscriptionRepository.markPastDueAsExpired).mockResolvedValue(false); // 다른 동시 요청이 이미 선점

    await expect(resubscribe("u-1", "monthly")).rejects.toMatchObject({ code: "SUBSCRIPTION_ALREADY_ACTIVE" });
    expect(tossClient.chargeBilling).not.toHaveBeenCalled();
    expect(subscriptionRepository.create).not.toHaveBeenCalled();
  });

  it("CHARGE_FAILED: 결제 실패 시 Subscription을 생성하지 않는다 (PaymentAttempt도 기록하지 않음 — 동기 실패는 재시도 가능)", async () => {
    vi.mocked(paymentMethodRepository.findByUserId).mockResolvedValue(paymentMethod({ billingKey: "bk-1" }));
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(subscription({ status: "past_due" }));
    vi.mocked(subscriptionRepository.markPastDueAsExpired).mockResolvedValue(true);
    vi.mocked(tossClient.chargeBilling).mockRejectedValue(new Error("카드 한도초과"));

    await expect(resubscribe("u-1", "monthly")).rejects.toMatchObject({ code: "CHARGE_FAILED" });
    expect(subscriptionRepository.create).not.toHaveBeenCalled();
  });
});

describe("subscription-service.getSubscriptionStatus (AC-009)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("구독 이력이 없으면 hasSubscription=false만 반환한다", async () => {
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(null);

    const result = await getSubscriptionStatus("u-1");

    expect(result).toEqual({ hasSubscription: false });
  });

  it("trial — plan/reason/nextBillingAt을 포함해 반환한다", async () => {
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(
      subscription({ status: "trial", plan: "monthly", nextBillingAt: "2026-09-22T00:00:00Z" })
    );

    const result = await getSubscriptionStatus("u-1");

    expect(result).toMatchObject({
      hasSubscription: true,
      plan: "monthly",
      reason: "trial_active",
      nextBillingAt: "2026-09-22T00:00:00Z",
    });
  });

  it("active — reason=paid_active", async () => {
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(subscription({ status: "active", plan: "yearly" }));

    const result = await getSubscriptionStatus("u-1");

    expect(result).toMatchObject({ hasSubscription: true, plan: "yearly", reason: "paid_active" });
  });

  it("canceled + 유예 중 — reason=grace_until_period_end, currentPeriodEnd 포함", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(
      subscription({ status: "canceled", currentPeriodEnd: future })
    );

    const result = await getSubscriptionStatus("u-1");

    expect(result).toMatchObject({ hasSubscription: true, reason: "grace_until_period_end", currentPeriodEnd: future });
  });

  it("past_due — reason=blocked:past_due (날짜는 페이지에서 표시하지 않지만 필드 자체는 그대로 반환됨)", async () => {
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(subscription({ status: "past_due" }));

    const result = await getSubscriptionStatus("u-1");

    expect(result).toMatchObject({ hasSubscription: true, reason: "blocked:past_due" });
  });

  it("expired — reason=blocked:expired", async () => {
    vi.mocked(subscriptionRepository.findLatestByUserId).mockResolvedValue(subscription({ status: "expired" }));

    const result = await getSubscriptionStatus("u-1");

    expect(result).toMatchObject({ hasSubscription: true, reason: "blocked:expired" });
  });
});
