import { describe, expect, it, vi, beforeEach } from "vitest";
import { runDailyBilling, expireCanceledSubscriptions } from "@/services/billing-service";
import * as subscriptionRepository from "@/lib/data/subscription-repository";
import * as paymentMethodRepository from "@/lib/data/payment-method-repository";
import * as paymentAttemptRepository from "@/lib/data/payment-attempt-repository";
import * as tossClient from "@/lib/data/toss-client";
import { RepositoryError } from "@/lib/data/errors";
import { TossApiError } from "@/lib/data/toss-client";
import type { PaymentMethodRecord, SubscriptionRecord } from "@/lib/data/records";

vi.mock("@/lib/data/subscription-repository");
vi.mock("@/lib/data/payment-method-repository");
vi.mock("@/lib/data/payment-attempt-repository");
// 함수(issueBillingKey/chargeBilling)만 자동 목킹하고 TossApiError/MissingTossEnvError는
// 실제 클래스 그대로 둔다 — 전체 자동목(vi.mock(module))은 클래스 생성자 로직까지
// 지워버려 new TossApiError(...)로 만든 인스턴스의 message/tossCode가 비어버린다.
vi.mock("@/lib/data/toss-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/toss-client")>();
  return { ...actual, issueBillingKey: vi.fn(), chargeBilling: vi.fn() };
});

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

describe("billing-service.runDailyBilling (AC-004, AC-005)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("대상이 없으면 빈 배열을 반환한다 (no-op)", async () => {
    vi.mocked(subscriptionRepository.findDueToday).mockResolvedValue([]);

    const result = await runDailyBilling();

    expect(result).toEqual([]);
    expect(tossClient.chargeBilling).not.toHaveBeenCalled();
  });

  it("이중 청구 방지: 청구 슬롯 선점(claimBillingSlot)에 실패하면 chargeBilling을 호출하지 않는다 (Test Designer 리뷰로 발견된 cron 겹침 레이스)", async () => {
    vi.mocked(subscriptionRepository.findDueToday).mockResolvedValue([subscription({ id: "sub-1" })]);
    // 동시에 겹친 다른 cron 실행이 먼저 이 청구를 가져갔다고 가정.
    vi.mocked(subscriptionRepository.claimBillingSlot).mockResolvedValue(false);

    const result = await runDailyBilling();

    expect(result).toEqual([{ subscriptionId: "sub-1", outcome: "error" }]);
    expect(paymentMethodRepository.findByUserId).not.toHaveBeenCalled();
    expect(tossClient.chargeBilling).not.toHaveBeenCalled();
  });

  it("단일 성공: PaymentAttempt(success) 기록 + status=active + 다음 주기 계산", async () => {
    vi.mocked(subscriptionRepository.findDueToday).mockResolvedValue([subscription({ id: "sub-1" })]);
    vi.mocked(subscriptionRepository.claimBillingSlot).mockResolvedValue(true);
    vi.mocked(paymentMethodRepository.findByUserId).mockResolvedValue(paymentMethod({ billingKey: "bk-1" }));
    vi.mocked(tossClient.chargeBilling).mockResolvedValue({ paymentKey: "pay-1", approvedAt: "2026-09-16T00:00:00Z" });
    vi.mocked(paymentAttemptRepository.create).mockResolvedValue({
      id: "pa-1",
      subscriptionId: "sub-1",
      attemptedAt: "2026-09-16T00:00:00Z",
      result: "success",
      amount: 9900,
      pgTransactionId: "pay-1",
      failureReason: null,
    });
    vi.mocked(subscriptionRepository.updateStatus).mockResolvedValue(subscription({ status: "active" }));

    const result = await runDailyBilling();

    expect(result).toEqual([{ subscriptionId: "sub-1", outcome: "success" }]);
    expect(paymentAttemptRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: "sub-1", result: "success", amount: 9900, pgTransactionId: "pay-1" })
    );
    expect(subscriptionRepository.updateStatus).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ status: "active", nextBillingAt: expect.any(String) })
    );
  });

  it("이중 청구 방어(defense-in-depth): 선점된 청구 주기(nextBillingAt)를 결정론적 Idempotency-Key로 chargeBilling에 전달한다 (/evolve Researcher 리뷰)", async () => {
    vi.mocked(subscriptionRepository.findDueToday).mockResolvedValue([
      subscription({ id: "sub-1", nextBillingAt: "2026-09-22T00:00:00Z" }),
    ]);
    vi.mocked(subscriptionRepository.claimBillingSlot).mockResolvedValue(true);
    vi.mocked(paymentMethodRepository.findByUserId).mockResolvedValue(paymentMethod({ billingKey: "bk-1" }));
    vi.mocked(tossClient.chargeBilling).mockResolvedValue({ paymentKey: "pay-1", approvedAt: "2026-09-16T00:00:00Z" });
    vi.mocked(paymentAttemptRepository.create).mockResolvedValue({
      id: "pa-1",
      subscriptionId: "sub-1",
      attemptedAt: "2026-09-16T00:00:00Z",
      result: "success",
      amount: 9900,
      pgTransactionId: "pay-1",
      failureReason: null,
    });
    vi.mocked(subscriptionRepository.updateStatus).mockResolvedValue(subscription({ status: "active" }));

    await runDailyBilling();

    expect(tossClient.chargeBilling).toHaveBeenCalledWith(
      "bk-1",
      expect.objectContaining({ idempotencyKey: "billing:sub-1:2026-09-22T00:00:00Z" })
    );
  });

  it("단일 실패: PaymentAttempt(failure) 기록 + status=past_due + nextBillingAt=null (유예 없이 즉시)", async () => {
    vi.mocked(subscriptionRepository.findDueToday).mockResolvedValue([subscription({ id: "sub-1" })]);
    vi.mocked(subscriptionRepository.claimBillingSlot).mockResolvedValue(true);
    vi.mocked(paymentMethodRepository.findByUserId).mockResolvedValue(paymentMethod({ billingKey: "bk-1" }));
    vi.mocked(tossClient.chargeBilling).mockRejectedValue(new Error("카드 한도초과"));
    vi.mocked(paymentAttemptRepository.create).mockResolvedValue({
      id: "pa-1",
      subscriptionId: "sub-1",
      attemptedAt: "2026-09-16T00:00:00Z",
      result: "failure",
      amount: 9900,
      pgTransactionId: null,
      failureReason: "카드 한도초과",
    });
    vi.mocked(subscriptionRepository.updateStatus).mockResolvedValue(subscription({ status: "past_due" }));

    const result = await runDailyBilling();

    expect(result).toEqual([{ subscriptionId: "sub-1", outcome: "failure" }]);
    expect(paymentAttemptRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: "sub-1", result: "failure", failureReason: "카드 한도초과" })
    );
    expect(subscriptionRepository.updateStatus).toHaveBeenCalledWith("sub-1", { status: "past_due", nextBillingAt: null });
  });

  it("토스의 구조화된 에러 코드(TossApiError.tossCode)를 failure_reason에 함께 남긴다 (/evolve Researcher 리뷰 — 감사 목적 테이블에서 코드가 버려지던 문제)", async () => {
    vi.mocked(subscriptionRepository.findDueToday).mockResolvedValue([subscription({ id: "sub-1" })]);
    vi.mocked(subscriptionRepository.claimBillingSlot).mockResolvedValue(true);
    vi.mocked(paymentMethodRepository.findByUserId).mockResolvedValue(paymentMethod({ billingKey: "bk-1" }));
    vi.mocked(tossClient.chargeBilling).mockRejectedValue(
      new TossApiError("결제에 실패했습니다: 한도초과", 400, "EXCEED_MAX_DAILY_PAYMENT_COUNT")
    );
    vi.mocked(paymentAttemptRepository.create).mockResolvedValue({
      id: "pa-1",
      subscriptionId: "sub-1",
      attemptedAt: "2026-09-16T00:00:00Z",
      result: "failure",
      amount: 9900,
      pgTransactionId: null,
      failureReason: "EXCEED_MAX_DAILY_PAYMENT_COUNT: 결제에 실패했습니다: 한도초과",
    });
    vi.mocked(subscriptionRepository.updateStatus).mockResolvedValue(subscription({ status: "past_due" }));

    await runDailyBilling();

    expect(paymentAttemptRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ failureReason: "EXCEED_MAX_DAILY_PAYMENT_COUNT: 결제에 실패했습니다: 한도초과" })
    );
  });

  it("부분 실패(실패 경로): 결제는 거절됐지만 past_due 전환(updateStatus)이 실패하면 partial_failure를 반환하고 다음 건은 계속 처리한다 (Navigator RETRY 사유 — handleChargeFailure/Success 비대칭 수정)", async () => {
    vi.mocked(subscriptionRepository.findDueToday).mockResolvedValue([
      subscription({ id: "sub-fail-partial", userId: "u-fail-partial" }),
      subscription({ id: "sub-ok3", userId: "u-ok3" }),
    ]);
    vi.mocked(subscriptionRepository.claimBillingSlot).mockResolvedValue(true);
    vi.mocked(paymentMethodRepository.findByUserId).mockResolvedValue(paymentMethod({ billingKey: "bk-1" }));
    vi.mocked(tossClient.chargeBilling)
      .mockRejectedValueOnce(new Error("카드 한도초과")) // sub-fail-partial
      .mockResolvedValueOnce({ paymentKey: "pay-ok3", approvedAt: "2026-09-16T00:00:00Z" }); // sub-ok3
    vi.mocked(paymentAttemptRepository.create).mockResolvedValue({
      id: "pa-1",
      subscriptionId: "sub-x",
      attemptedAt: "2026-09-16T00:00:00Z",
      result: "failure",
      amount: 9900,
      pgTransactionId: null,
      failureReason: "카드 한도초과",
    });
    vi.mocked(subscriptionRepository.updateStatus)
      .mockRejectedValueOnce(new RepositoryError("DB 쓰기 실패")) // sub-fail-partial의 past_due 전환 실패
      .mockResolvedValueOnce(subscription({ status: "active" })); // sub-ok3

    const result = await runDailyBilling();

    expect(result).toEqual([
      { subscriptionId: "sub-fail-partial", outcome: "partial_failure" },
      { subscriptionId: "sub-ok3", outcome: "success" },
    ]);
    // 결제 거절 기록 자체는 여전히 시도됐어야 한다(독립 try/catch).
    expect(paymentAttemptRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: "sub-fail-partial", result: "failure" })
    );
  });

  it("루프 격리: 한 건에서 예상 못 한 예외가 나도 나머지 건은 정상 처리된다", async () => {
    vi.mocked(subscriptionRepository.findDueToday).mockResolvedValue([
      subscription({ id: "sub-broken", userId: "u-broken" }),
      subscription({ id: "sub-ok", userId: "u-ok" }),
    ]);
    vi.mocked(subscriptionRepository.claimBillingSlot).mockResolvedValue(true);
    vi.mocked(paymentMethodRepository.findByUserId).mockImplementation(async (userId: string) => {
      if (userId === "u-broken") throw new RepositoryError("DB 연결 끊김");
      return paymentMethod({ userId: "u-ok", billingKey: "bk-ok" });
    });
    vi.mocked(tossClient.chargeBilling).mockResolvedValue({ paymentKey: "pay-ok", approvedAt: "2026-09-16T00:00:00Z" });
    vi.mocked(paymentAttemptRepository.create).mockResolvedValue({
      id: "pa-1",
      subscriptionId: "sub-ok",
      attemptedAt: "2026-09-16T00:00:00Z",
      result: "success",
      amount: 9900,
      pgTransactionId: "pay-ok",
      failureReason: null,
    });
    vi.mocked(subscriptionRepository.updateStatus).mockResolvedValue(subscription({ status: "active" }));

    const result = await runDailyBilling();

    expect(result).toEqual([
      { subscriptionId: "sub-broken", outcome: "error" },
      { subscriptionId: "sub-ok", outcome: "success" },
    ]);
  });

  it("부분 실패: 청구는 성공했지만 Subscription 상태 갱신이 실패하면 partial_failure를 반환하고 다음 건은 계속 처리한다", async () => {
    vi.mocked(subscriptionRepository.findDueToday).mockResolvedValue([
      subscription({ id: "sub-partial", userId: "u-partial" }),
      subscription({ id: "sub-ok2", userId: "u-ok2" }),
    ]);
    vi.mocked(subscriptionRepository.claimBillingSlot).mockResolvedValue(true);
    vi.mocked(paymentMethodRepository.findByUserId).mockResolvedValue(paymentMethod({ billingKey: "bk-1" }));
    vi.mocked(tossClient.chargeBilling).mockResolvedValue({ paymentKey: "pay-1", approvedAt: "2026-09-16T00:00:00Z" });
    vi.mocked(paymentAttemptRepository.create).mockResolvedValue({
      id: "pa-1",
      subscriptionId: "sub-partial",
      attemptedAt: "2026-09-16T00:00:00Z",
      result: "success",
      amount: 9900,
      pgTransactionId: "pay-1",
      failureReason: null,
    });
    vi.mocked(subscriptionRepository.updateStatus)
      .mockRejectedValueOnce(new RepositoryError("DB 쓰기 실패")) // sub-partial
      .mockResolvedValueOnce(subscription({ status: "active" })); // sub-ok2

    const result = await runDailyBilling();

    expect(result).toEqual([
      { subscriptionId: "sub-partial", outcome: "partial_failure" },
      { subscriptionId: "sub-ok2", outcome: "success" },
    ]);
    // 청구는 실제로 성공했으므로 PaymentAttempt 기록은 여전히 시도됐어야 한다(독립 try/catch).
    expect(paymentAttemptRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: "sub-partial", result: "success" })
    );
  });

  it("PaymentMethod가 없는 이상 상태는 청구를 시도하지 않고 error로 기록한다", async () => {
    vi.mocked(subscriptionRepository.findDueToday).mockResolvedValue([subscription({ id: "sub-1" })]);
    vi.mocked(subscriptionRepository.claimBillingSlot).mockResolvedValue(true);
    vi.mocked(paymentMethodRepository.findByUserId).mockResolvedValue(null);

    const result = await runDailyBilling();

    expect(result).toEqual([{ subscriptionId: "sub-1", outcome: "error" }]);
    expect(tossClient.chargeBilling).not.toHaveBeenCalled();
  });
});

describe("billing-service.expireCanceledSubscriptions (AC-007)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("대상이 없으면 빈 배열을 반환한다 (no-op)", async () => {
    vi.mocked(subscriptionRepository.findExpiredCanceled).mockResolvedValue([]);

    const result = await expireCanceledSubscriptions();

    expect(result).toEqual([]);
    expect(subscriptionRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("단일 성공: status=expired로 전환한다", async () => {
    vi.mocked(subscriptionRepository.findExpiredCanceled).mockResolvedValue([
      subscription({ id: "sub-1", status: "canceled" }),
    ]);
    vi.mocked(subscriptionRepository.updateStatus).mockResolvedValue(subscription({ status: "expired" }));

    const result = await expireCanceledSubscriptions();

    expect(result).toEqual([{ subscriptionId: "sub-1", outcome: "success" }]);
    expect(subscriptionRepository.updateStatus).toHaveBeenCalledWith("sub-1", { status: "expired" });
  });

  it("루프 격리: 한 건의 갱신 실패가 나머지 건 처리를 막지 않는다", async () => {
    vi.mocked(subscriptionRepository.findExpiredCanceled).mockResolvedValue([
      subscription({ id: "sub-broken", status: "canceled" }),
      subscription({ id: "sub-ok", status: "canceled" }),
    ]);
    vi.mocked(subscriptionRepository.updateStatus)
      .mockRejectedValueOnce(new RepositoryError("DB 쓰기 실패")) // sub-broken
      .mockResolvedValueOnce(subscription({ status: "expired" })); // sub-ok

    const result = await expireCanceledSubscriptions();

    expect(result).toEqual([
      { subscriptionId: "sub-broken", outcome: "error" },
      { subscriptionId: "sub-ok", outcome: "success" },
    ]);
  });
});
