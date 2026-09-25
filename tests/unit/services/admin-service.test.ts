import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  isAdminEmail,
  getServiceStats,
  detectDuplicateActiveSubscriptions,
  getRevenueSummary,
  listSubscribers,
  getSubscriberDetail,
  classifyStuckSubscription,
  detectStuckSubscriptions,
  isStuckCandidate,
  recoverStuckSubscription,
} from "@/services/admin-service";
import * as userRepository from "@/lib/data/user-repository";
import * as healthLogRepository from "@/lib/data/health-log-repository";
import * as careLinkRepository from "@/lib/data/care-link-repository";
import * as subscriptionRepository from "@/lib/data/subscription-repository";
import * as paymentAttemptRepository from "@/lib/data/payment-attempt-repository";
import * as adminActionLogRepository from "@/lib/data/admin-action-log-repository";
import type { SubscriptionRecord, UserRecord, PaymentAttemptRecord } from "@/lib/data/records";

vi.mock("@/lib/data/user-repository");
vi.mock("@/lib/data/health-log-repository");
vi.mock("@/lib/data/care-link-repository");
vi.mock("@/lib/data/admin-action-log-repository");
vi.mock("@/lib/data/subscription-repository");
vi.mock("@/lib/data/payment-attempt-repository");

function subscription(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    id: "sub-1",
    userId: "u-1",
    plan: "monthly",
    amount: 9900,
    status: "active",
    trialEndAt: null,
    currentPeriodStart: "2026-09-01T00:00:00Z",
    currentPeriodEnd: "2026-10-01T00:00:00Z",
    nextBillingAt: "2026-10-01T00:00:00Z",
    canceledAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "u-1",
    email: "user@e2e.local",
    name: "테스트유저",
    birthDate: "1990-01-01",
    agentPersonaId: null,
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function paymentAttempt(overrides: Partial<PaymentAttemptRecord> = {}): PaymentAttemptRecord {
  return {
    id: "pa-1",
    subscriptionId: "sub-1",
    attemptedAt: "2026-09-01T00:00:00Z",
    result: "success",
    amount: 9900,
    pgTransactionId: "pay-1",
    failureReason: null,
    ...overrides,
  };
}

describe("admin-service.getSubscriberDetail (T-018, AC-003)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("존재하지 않는 userId는 null을 반환한다(구독 이력 0건과 구분)", async () => {
    vi.mocked(userRepository.getUserById).mockResolvedValue(null);

    const result = await getSubscriberDetail("no-such-user");

    expect(result).toBeNull();
    expect(subscriptionRepository.findAllByUserId).not.toHaveBeenCalled();
  });

  it("존재하지만 구독 이력이 0건인 유저는 subscriptions: []를 반환한다(null 아님)", async () => {
    vi.mocked(userRepository.getUserById).mockResolvedValue(user());
    vi.mocked(subscriptionRepository.findAllByUserId).mockResolvedValue([]);

    const result = await getSubscriberDetail("u-1");

    expect(result).toEqual({ user: { id: "u-1", email: "user@e2e.local", name: "테스트유저" }, subscriptions: [] });
  });

  it("여러 Subscription 각각에 결제이력이 정확히 매칭된다", async () => {
    vi.mocked(userRepository.getUserById).mockResolvedValue(user());
    vi.mocked(subscriptionRepository.findAllByUserId).mockResolvedValue([
      subscription({ id: "sub-old", status: "expired" }),
      subscription({ id: "sub-new", status: "active" }),
    ]);
    vi.mocked(paymentAttemptRepository.findBySubscriptionId).mockImplementation(async (subscriptionId: string) => {
      if (subscriptionId === "sub-old") return [paymentAttempt({ id: "pa-old", subscriptionId: "sub-old" })];
      if (subscriptionId === "sub-new") return [];
      throw new Error("unexpected subscriptionId");
    });

    const result = await getSubscriberDetail("u-1");

    expect(result!.subscriptions).toHaveLength(2);
    expect(result!.subscriptions.find((s) => s.id === "sub-old")!.paymentAttempts).toEqual([
      paymentAttempt({ id: "pa-old", subscriptionId: "sub-old" }),
    ]);
    expect(result!.subscriptions.find((s) => s.id === "sub-new")!.paymentAttempts).toEqual([]);
  });
});

describe("admin-service.classifyStuckSubscription (T-019, AC-005/AC-006)", () => {
  it("최근 시도 기록이 없으면 undetermined", () => {
    expect(classifyStuckSubscription(subscription(), null)).toBe("undetermined");
  });

  it("최근 시도가 success면 recoverable", () => {
    expect(classifyStuckSubscription(subscription(), paymentAttempt({ result: "success" }))).toBe("recoverable");
  });

  it("최근 시도가 failure면 not_recoverable", () => {
    expect(classifyStuckSubscription(subscription(), paymentAttempt({ result: "failure" }))).toBe("not_recoverable");
  });

  it("[계약 문서화] latestAttempt는 호출부가 반드시 해당 subscription의 최근 시도여야 한다 — 다른 구독의 기록을 넘기면 함수는 구분 없이 그대로 신뢰해 오분류한다", () => {
    // 이 테스트는 버그를 검증하는 게 아니라, 순수 함수의 신뢰 경계(계약)를
    // 명시적으로 보여준다 — 실제 오분류를 막는 책임은 호출부(detectStuckSubscriptions/
    // recoverStuckSubscription)가 findLatestBySubscriptionId(sub.id)를 정확히
    // 그 subscription으로 호출하는 데 있다.
    const otherSubscriptionsAttempt = paymentAttempt({ subscriptionId: "sub-completely-different", result: "success" });
    expect(classifyStuckSubscription(subscription({ id: "sub-1" }), otherSubscriptionsAttempt)).toBe("recoverable");
  });
});

describe("admin-service.detectStuckSubscriptions (T-020, AC-005)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("후보 목록을 각자의 최근 시도 기준으로 recoverable/not_recoverable/undetermined로 분류한다", async () => {
    vi.mocked(subscriptionRepository.findStuckCandidates).mockResolvedValue([
      subscription({ id: "sub-recoverable" }),
      subscription({ id: "sub-not-recoverable" }),
      subscription({ id: "sub-undetermined" }),
    ]);
    vi.mocked(paymentAttemptRepository.findLatestBySubscriptionId).mockImplementation(async (id: string) => {
      if (id === "sub-recoverable") return paymentAttempt({ subscriptionId: id, result: "success" });
      if (id === "sub-not-recoverable") return paymentAttempt({ subscriptionId: id, result: "failure" });
      return null;
    });

    const result = await detectStuckSubscriptions();

    expect(result).toEqual([
      { subscription: subscription({ id: "sub-recoverable" }), classification: "recoverable" },
      { subscription: subscription({ id: "sub-not-recoverable" }), classification: "not_recoverable" },
      { subscription: subscription({ id: "sub-undetermined" }), classification: "undetermined" },
    ]);
  });

  it("후보가 없으면 빈 배열을 반환한다", async () => {
    vi.mocked(subscriptionRepository.findStuckCandidates).mockResolvedValue([]);

    const result = await detectStuckSubscriptions();

    expect(result).toEqual([]);
    expect(paymentAttemptRepository.findLatestBySubscriptionId).not.toHaveBeenCalled();
  });
});

function stuckSubscription(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return subscription({ status: "active", nextBillingAt: null, currentPeriodEnd: past, ...overrides });
}

describe("admin-service.isStuckCandidate (AC-006)", () => {
  it("status IN(trial,active) AND next_billing_at IS NULL AND current_period_end < now면 true", () => {
    expect(isStuckCandidate(stuckSubscription())).toBe(true);
  });

  it("next_billing_at이 있으면(정상 구독) false", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(isStuckCandidate(stuckSubscription({ nextBillingAt: future }))).toBe(false);
  });

  it("current_period_end가 아직 안 지났으면 false", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(isStuckCandidate(stuckSubscription({ currentPeriodEnd: future }))).toBe(false);
  });

  it("status가 canceled/past_due/expired면 false", () => {
    expect(isStuckCandidate(stuckSubscription({ status: "canceled" }))).toBe(false);
    expect(isStuckCandidate(stuckSubscription({ status: "past_due" }))).toBe(false);
    expect(isStuckCandidate(stuckSubscription({ status: "expired" }))).toBe(false);
  });
});

describe("admin-service.recoverStuckSubscription (T-022, AC-006 — 유일한 쓰기 액션)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("존재하지 않는 subscriptionId는 SUBSCRIPTION_NOT_FOUND를 던지고 아무것도 갱신하지 않는다", async () => {
    vi.mocked(subscriptionRepository.findById).mockResolvedValue(null);

    await expect(recoverStuckSubscription("admin-1", "no-such-sub")).rejects.toMatchObject({
      code: "SUBSCRIPTION_NOT_FOUND",
    });
    expect(subscriptionRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("[취약점 회귀 테스트] 이미 정상 active인(구조적으로 방치 상태가 아닌) 구독은 최근 결제가 success여도 NOT_RECOVERABLE로 거부된다", async () => {
    // isStuckCandidate가 false인 케이스 — classifyStuckSubscription만 봤다면
    // "recoverable"이 나와 무료로 주기를 연장해주는 취약점이 있었다(Navigator 리뷰).
    const normalActive = stuckSubscription({ nextBillingAt: new Date(Date.now() + 86_400_000).toISOString() });
    vi.mocked(subscriptionRepository.findById).mockResolvedValue(normalActive);
    vi.mocked(paymentAttemptRepository.findLatestBySubscriptionId).mockResolvedValue(
      paymentAttempt({ result: "success" })
    );

    await expect(recoverStuckSubscription("admin-1", normalActive.id)).rejects.toMatchObject({
      code: "NOT_RECOVERABLE",
    });
    expect(subscriptionRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("서버 재검증에서 최근 결제가 failure(not_recoverable)면 클라이언트가 뭐라 하든 거부하고 Subscription을 바꾸지 않는다", async () => {
    const sub = stuckSubscription();
    vi.mocked(subscriptionRepository.findById).mockResolvedValue(sub);
    vi.mocked(paymentAttemptRepository.findLatestBySubscriptionId).mockResolvedValue(
      paymentAttempt({ result: "failure" })
    );

    await expect(recoverStuckSubscription("admin-1", sub.id)).rejects.toMatchObject({ code: "NOT_RECOVERABLE" });
    expect(subscriptionRepository.updateStatus).not.toHaveBeenCalled();
    expect(adminActionLogRepository.create).not.toHaveBeenCalled();
  });

  it("서버 재검증에서 시도 기록 자체가 없으면(undetermined) 거부한다", async () => {
    const sub = stuckSubscription();
    vi.mocked(subscriptionRepository.findById).mockResolvedValue(sub);
    vi.mocked(paymentAttemptRepository.findLatestBySubscriptionId).mockResolvedValue(null);

    await expect(recoverStuckSubscription("admin-1", sub.id)).rejects.toMatchObject({ code: "NOT_RECOVERABLE" });
    expect(subscriptionRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("recoverable로 재확인되면 status=active+다음 주기로 갱신하고 AdminActionLog를 기록한다", async () => {
    const sub = stuckSubscription({ id: "sub-recover", status: "trial", plan: "monthly" });
    vi.mocked(subscriptionRepository.findById).mockResolvedValue(sub);
    vi.mocked(paymentAttemptRepository.findLatestBySubscriptionId).mockResolvedValue(
      paymentAttempt({ result: "success" })
    );
    const updated = { ...sub, status: "active" as const };
    vi.mocked(subscriptionRepository.updateStatus).mockResolvedValue(updated);
    vi.mocked(adminActionLogRepository.create).mockResolvedValue({
      id: "log-1",
      adminUserId: "admin-1",
      subscriptionId: "sub-recover",
      actionType: "recover_partial_failure",
      previousStatus: "trial",
      newStatus: "active",
      performedAt: "2026-09-18T00:00:00Z",
    });

    const result = await recoverStuckSubscription("admin-1", "sub-recover");

    expect(result).toEqual({ outcome: "recovered", subscription: updated });
    expect(subscriptionRepository.updateStatus).toHaveBeenCalledWith(
      "sub-recover",
      expect.objectContaining({ status: "active", nextBillingAt: expect.any(String) })
    );
    expect(adminActionLogRepository.create).toHaveBeenCalledWith({
      adminUserId: "admin-1",
      subscriptionId: "sub-recover",
      actionType: "recover_partial_failure",
      previousStatus: "trial", // 복구 직전 원래 status — new_status와 달라야 감사 기록의 의미가 있다.
      newStatus: "active",
    });
  });

  it("Subscription 갱신은 성공했지만 AdminActionLog 기록만 실패하면 recovered_log_failed를 반환한다(상태 변경 자체는 유효)", async () => {
    const sub = stuckSubscription({ id: "sub-log-fail" });
    vi.mocked(subscriptionRepository.findById).mockResolvedValue(sub);
    vi.mocked(paymentAttemptRepository.findLatestBySubscriptionId).mockResolvedValue(
      paymentAttempt({ result: "success" })
    );
    const updated = { ...sub, status: "active" as const };
    vi.mocked(subscriptionRepository.updateStatus).mockResolvedValue(updated);
    vi.mocked(adminActionLogRepository.create).mockRejectedValue(new Error("DB 쓰기 실패"));

    const result = await recoverStuckSubscription("admin-1", "sub-log-fail");

    expect(result).toEqual({ outcome: "recovered_log_failed", subscription: updated });
  });
});

describe("admin-service.isAdminEmail (T-014, AC-008)", () => {
  const original = process.env.ADMIN_EMAIL;
  afterEach(() => {
    process.env.ADMIN_EMAIL = original;
  });

  it("ADMIN_EMAIL과 정확히 일치하면 true", () => {
    process.env.ADMIN_EMAIL = "admin@e2e.local";
    expect(isAdminEmail("admin@e2e.local")).toBe(true);
  });

  it("ADMIN_EMAIL과 다르면 false", () => {
    process.env.ADMIN_EMAIL = "admin@e2e.local";
    expect(isAdminEmail("user@e2e.local")).toBe(false);
  });

  it("대소문자가 다르면 불일치로 처리한다 (엄격 비교, 느슨한 매칭 없음)", () => {
    process.env.ADMIN_EMAIL = "admin@e2e.local";
    expect(isAdminEmail("ADMIN@e2e.local")).toBe(false);
  });

  it("ADMIN_EMAIL 환경변수가 없으면 어떤 이메일이 와도 false (fail-closed)", () => {
    delete process.env.ADMIN_EMAIL;
    expect(isAdminEmail("admin@e2e.local")).toBe(false);
  });

  it("email이 null/undefined면 false", () => {
    process.env.ADMIN_EMAIL = "admin@e2e.local";
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });
});

describe("admin-service.getRevenueSummary (T-016, AC-001)", () => {
  beforeEach(() => vi.resetAllMocks());

  const statusCounts = { trial: 1, active: 2, canceled: 3, past_due: 4, expired: 5 };

  it("range가 없으면 sumSuccessAmountInRange를 호출하지 않고 revenueTotal=0을 반환한다", async () => {
    vi.mocked(subscriptionRepository.countByStatus).mockResolvedValue(statusCounts);

    const result = await getRevenueSummary();

    expect(result).toEqual({ statusCounts, revenueTotal: 0 });
    expect(paymentAttemptRepository.sumSuccessAmountInRange).not.toHaveBeenCalled();
  });

  it("range가 있으면 sumSuccessAmountInRange를 호출해 revenueTotal을 채운다", async () => {
    vi.mocked(subscriptionRepository.countByStatus).mockResolvedValue(statusCounts);
    vi.mocked(paymentAttemptRepository.sumSuccessAmountInRange).mockResolvedValue(128700);

    const range = { start: "2026-09-01T00:00:00.000Z", end: "2026-10-01T00:00:00.000Z" };
    const result = await getRevenueSummary(range);

    expect(result).toEqual({ statusCounts, revenueTotal: 128700 });
    expect(paymentAttemptRepository.sumSuccessAmountInRange).toHaveBeenCalledWith(range);
  });
});

describe("admin-service.listSubscribers (T-017, AC-002)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("쿼리를 그대로 searchSubscribers에 위임하고 결과를 그대로 반환한다", async () => {
    const result = {
      items: [{ userId: "u-1", email: "a@e2e.local", name: "테스트", status: "active" as const, plan: "monthly" as const, currentPeriodEnd: "2026-10-01T00:00:00Z" }],
      page: 1,
      pageSize: 20,
      totalCount: 1,
    };
    vi.mocked(subscriptionRepository.searchSubscribers).mockResolvedValue(result);

    const query = { search: "a@e2e.local", status: "active" as const, page: 1 };
    const returned = await listSubscribers(query);

    expect(subscriptionRepository.searchSubscribers).toHaveBeenCalledWith(query);
    expect(returned).toEqual(result);
  });
});

describe("admin-service.getServiceStats (T-015, AC-004)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("가입자/HealthLog/활성 CareLink 개수를 조합해 반환한다", async () => {
    vi.mocked(userRepository.countAll).mockResolvedValue(42);
    vi.mocked(healthLogRepository.countAll).mockResolvedValue(1234);
    vi.mocked(careLinkRepository.countByStatus).mockResolvedValue(7);

    const result = await getServiceStats();

    expect(result).toEqual({ userCount: 42, healthLogCount: 1234, activeCareLinkCount: 7 });
    expect(careLinkRepository.countByStatus).toHaveBeenCalledWith("accepted");
  });
});

describe("admin-service.detectDuplicateActiveSubscriptions (T-021, AC-007)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("repository 결과를 그대로 반환한다", async () => {
    const groups = [
      {
        userId: "u-dup",
        subscriptions: [subscription({ id: "sub-a" }), subscription({ id: "sub-b", status: "past_due" })],
      },
    ];
    vi.mocked(subscriptionRepository.findDuplicateActiveGroups).mockResolvedValue(groups);

    const result = await detectDuplicateActiveSubscriptions();

    expect(result).toEqual(groups);
  });

  it("중복이 없으면 빈 배열을 반환한다", async () => {
    vi.mocked(subscriptionRepository.findDuplicateActiveGroups).mockResolvedValue([]);

    const result = await detectDuplicateActiveSubscriptions();

    expect(result).toEqual([]);
  });
});
