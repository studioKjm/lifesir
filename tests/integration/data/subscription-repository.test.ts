import { afterEach, describe, expect, it } from "vitest";
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

async function createTestUser(prefix: string) {
  const auth = await createTestAuthUser(prefix);
  createdIds.push(auth.id);
  await userRepository.createUser({ id: auth.id, email: auth.email, name: "테스트 사용자", agentPersonaId: null });
  return auth;
}

async function createNamedUser(prefix: string, name: string) {
  const auth = await createTestAuthUser(prefix);
  createdIds.push(auth.id);
  await userRepository.createUser({ id: auth.id, email: auth.email, name, agentPersonaId: null });
  return auth;
}

describe("subscription-repository (통합, 로컬 Supabase)", () => {
  it("trial 상태로 생성할 수 있다", async () => {
    const user = await createTestUser("sub-repo");
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const created = await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "trial",
      trialEndAt: trialEnd.toISOString(),
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: trialEnd.toISOString(),
      nextBillingAt: trialEnd.toISOString(),
    });

    expect(created.status).toBe("trial");
    expect(created.plan).toBe("monthly");
    expect(created.amount).toBe(9900);
    expect(created.trialEndAt).not.toBeNull();
  });

  it("잘못된 plan/status 값은 DB check 제약으로 거부된다", async () => {
    const user = await createTestUser("sub-invalid");
    const now = new Date().toISOString();

    await expect(
      subscriptionRepository.create({
        userId: user.id,
        // @ts-expect-error - 제약 위반을 의도적으로 재현
        plan: "weekly",
        amount: 1000,
        status: "trial",
        trialEndAt: null,
        currentPeriodStart: now,
        currentPeriodEnd: now,
        nextBillingAt: null,
      })
    ).rejects.toThrow();
  });

  it("findLatestByUserId — User가 여러 Subscription을 가질 때(재구독) 가장 최근 것만 반환한다 (AC-001)", async () => {
    const user = await createTestUser("sub-latest");
    const now = new Date().toISOString();

    const first = await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "expired",
      trialEndAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: now,
      nextBillingAt: null,
    });
    const second = await subscriptionRepository.create({
      userId: user.id,
      plan: "yearly",
      amount: 99000,
      status: "active",
      trialEndAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: now,
      nextBillingAt: now,
    });

    const latest = await subscriptionRepository.findLatestByUserId(user.id);

    expect(latest?.id).toBe(second.id);
    expect(latest?.id).not.toBe(first.id);
    expect(latest?.status).toBe("active");
  });

  it("findLatestByUserId — Subscription이 없으면 null을 반환한다", async () => {
    const user = await createTestUser("sub-none");
    expect(await subscriptionRepository.findLatestByUserId(user.id)).toBeNull();
  });

  it("updateStatus — status/canceledAt/nextBillingAt만 바뀌고 current_period_end는 그대로다 (AC-006)", async () => {
    const user = await createTestUser("sub-cancel");
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const created = await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "trial",
      trialEndAt: periodEnd,
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: periodEnd,
      nextBillingAt: periodEnd,
    });

    const canceledAt = new Date().toISOString();
    const updated = await subscriptionRepository.updateStatus(created.id, {
      status: "canceled",
      canceledAt,
      nextBillingAt: null,
    });

    expect(updated.status).toBe("canceled");
    // Postgres timestamptz는 "+00:00" 오프셋으로 돌아온다(JS Date의 toISOString()이
    // 만드는 "Z" 표기와 문자열은 다르지만 같은 시각) — 파싱해 비교한다.
    expect(new Date(updated.canceledAt!).getTime()).toBe(new Date(canceledAt).getTime());
    expect(updated.nextBillingAt).toBeNull();
    // AC-001의 해지 유예 판정이 읽는 필드 — updateStatus가 절대 건드리면 안 된다.
    expect(new Date(updated.currentPeriodEnd).getTime()).toBe(new Date(created.currentPeriodEnd).getTime());
  });

  it("markPastDueAsExpired — past_due 레코드만 expired로 전이되고 true를 반환한다 (AC-008)", async () => {
    const user = await createTestUser("sub-mark-pastdue");
    const now = new Date().toISOString();
    const created = await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "past_due",
      trialEndAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: now,
      nextBillingAt: null,
    });

    const won = await subscriptionRepository.markPastDueAsExpired(created.id);

    expect(won).toBe(true);
    const latest = await subscriptionRepository.findLatestByUserId(user.id);
    expect(latest?.status).toBe("expired");
  });

  it("markPastDueAsExpired — 이미 past_due가 아니면(레이스에서 진 경우) false를 반환하고 아무것도 바뀌지 않는다 (AC-008 이중청구 방지)", async () => {
    const user = await createTestUser("sub-mark-race");
    const now = new Date().toISOString();
    const created = await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "past_due",
      trialEndAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: now,
      nextBillingAt: null,
    });
    // 먼저 도착한 요청이 이미 선점했다고 가정 — 직접 expired로 바꿔둔다.
    await subscriptionRepository.updateStatus(created.id, { status: "expired" });

    const won = await subscriptionRepository.markPastDueAsExpired(created.id);

    expect(won).toBe(false);
  });

  it("findDueToday — 오늘 next_billing_at이고 trial/active인 것만 반환한다 (AC-004)", async () => {
    const user = await createTestUser("sub-due-today");
    const now = new Date();
    const todayNoon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
    const yesterday = new Date(todayNoon.getTime() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(todayNoon.getTime() + 24 * 60 * 60 * 1000);

    const dueTrial = await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "trial",
      trialEndAt: todayNoon.toISOString(),
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: todayNoon.toISOString(),
      nextBillingAt: todayNoon.toISOString(),
    });

    // 오늘이지만 status가 past_due(대상 아님)
    const pastDueToday = await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "past_due",
      trialEndAt: null,
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: todayNoon.toISOString(),
      nextBillingAt: todayNoon.toISOString(),
    });

    // 어제/내일 날짜(대상 아님) — 정확 날짜 매치, 캐치업 쿼리 아님(AC-008과 동일한 이중청구 방지 설계).
    const dueYesterday = await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "active",
      trialEndAt: null,
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: yesterday.toISOString(),
      nextBillingAt: yesterday.toISOString(),
    });
    const dueTomorrow = await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "active",
      trialEndAt: null,
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: tomorrow.toISOString(),
      nextBillingAt: tomorrow.toISOString(),
    });

    // findDueToday는 전체 테이블을 조회하므로(cron 배치의 실제 동작과 동일),
    // 병렬로 돌아가는 다른 통합 테스트가 만든 "오늘" 레코드가 섞여 있을 수
    // 있다 — 정확한 개수 대신 이 테스트가 만든 레코드들의 포함/제외 여부만
    // 확인한다(pool: "threads"로 여러 테스트 파일이 같은 로컬 DB를 동시에 쓴다).
    const due = await subscriptionRepository.findDueToday();
    const dueIds = due.map((s) => s.id);

    expect(dueIds).toContain(dueTrial.id);
    expect(dueIds).not.toContain(pastDueToday.id);
    expect(dueIds).not.toContain(dueYesterday.id);
    expect(dueIds).not.toContain(dueTomorrow.id);
  });

  it("findExpiredCanceled — canceled+기간지남만 포함하고, 유예중/다른 상태는 제외한다 (AC-007)", async () => {
    const user = await createTestUser("sub-expired-canceled");
    const now = new Date();
    const past = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const future = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // canceled + 기간 지남 → 대상
    const expiredCanceled = await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "canceled",
      trialEndAt: null,
      currentPeriodStart: past.toISOString(),
      currentPeriodEnd: past.toISOString(),
      nextBillingAt: null,
    });

    // canceled + 유예중(기간 안 지남) → 대상 아님
    const gracePeriodCanceled = await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "canceled",
      trialEndAt: null,
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: future.toISOString(),
      nextBillingAt: null,
    });

    // 기간은 지났지만 status가 canceled가 아님(active) → 대상 아님
    const activeButPastPeriod = await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "active",
      trialEndAt: null,
      currentPeriodStart: past.toISOString(),
      currentPeriodEnd: past.toISOString(),
      nextBillingAt: past.toISOString(),
    });

    const expired = await subscriptionRepository.findExpiredCanceled();
    const expiredIds = expired.map((s) => s.id);

    expect(expiredIds).toContain(expiredCanceled.id);
    expect(expiredIds).not.toContain(gracePeriodCanceled.id);
    expect(expiredIds).not.toContain(activeButPastPeriod.id);
  });

  it("claimBillingSlot — next_billing_at이 일치할 때만 선점(null로 전환)에 성공한다 (AC-004 이중청구 방지)", async () => {
    const user = await createTestUser("sub-claim");
    const now = new Date().toISOString();
    const created = await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "active",
      trialEndAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: now,
      nextBillingAt: now,
    });

    const won = await subscriptionRepository.claimBillingSlot(created.id, created.nextBillingAt!);

    expect(won).toBe(true);
    const latest = await subscriptionRepository.findLatestByUserId(user.id);
    expect(latest?.nextBillingAt).toBeNull();
  });

  it("claimBillingSlot — 이미 선점(next_billing_at=null)된 레코드는 다시 선점할 수 없다(레이스에서 진 경우)", async () => {
    const user = await createTestUser("sub-claim-race");
    const now = new Date().toISOString();
    const created = await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "active",
      trialEndAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: now,
      nextBillingAt: now,
    });
    // 먼저 도착한 cron 실행이 이미 선점했다고 가정.
    await subscriptionRepository.claimBillingSlot(created.id, created.nextBillingAt!);

    // 같은 (오래된) nextBillingAt 값으로 다시 선점 시도 — 이미 null로 바뀌어
    // WHERE 조건에 걸리지 않는다.
    const wonAgain = await subscriptionRepository.claimBillingSlot(created.id, created.nextBillingAt!);

    expect(wonAgain).toBe(false);
  });

  it("findById — id로 단건 조회할 수 있고, 없으면 null을 반환한다 (AC-006)", async () => {
    const user = await createTestUser("find-by-id");
    const now = new Date().toISOString();
    const created = await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "active",
      trialEndAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: now,
      nextBillingAt: now,
    });

    const found = await subscriptionRepository.findById(created.id);
    const notFound = await subscriptionRepository.findById("00000000-0000-0000-0000-000000000000");

    expect(found?.id).toBe(created.id);
    expect(notFound).toBeNull();
  });

  it("findStuckCandidates — status IN(trial,active) AND next_billing_at IS NULL AND current_period_end < now인 것만 반환한다 (T-006, seed-v4 AC-005)", async () => {
    const stuck = await createTestUser("stuck-candidate");
    const normal = await createTestUser("stuck-normal-active");
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const stuckSub = await subscriptionRepository.create({
      userId: stuck.id,
      plan: "monthly",
      amount: 9900,
      status: "active",
      trialEndAt: null,
      currentPeriodStart: past,
      currentPeriodEnd: past,
      nextBillingAt: null, // claimBillingSlot이 선점 후 반영 실패한 흔적
    });
    // 정상 active(next_billing_at 있고 기간도 미래) — 절대 잡히면 안 됨.
    await subscriptionRepository.create({
      userId: normal.id,
      plan: "monthly",
      amount: 9900,
      status: "active",
      trialEndAt: null,
      currentPeriodStart: future,
      currentPeriodEnd: future,
      nextBillingAt: future,
    });

    const candidates = await subscriptionRepository.findStuckCandidates();

    expect(candidates.map((c) => c.id)).toContain(stuckSub.id);
    expect(candidates.map((c) => c.userId)).not.toContain(normal.id);
  });

  it("findAllByUserId — 재구독 이력 전체를 최신순(created_at desc)으로 반환한다 (T-005, seed-v4 AC-003)", async () => {
    const user = await createTestUser("find-all-by-user");
    const now = new Date().toISOString();
    const first = await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "expired",
      trialEndAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: now,
      nextBillingAt: null,
    });
    const second = await subscriptionRepository.create({
      userId: user.id,
      plan: "yearly",
      amount: 99000,
      status: "active",
      trialEndAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: now,
      nextBillingAt: now,
    });

    const all = await subscriptionRepository.findAllByUserId(user.id);

    expect(all.map((s) => s.id)).toEqual([second.id, first.id]);
  });

  it("findAllByUserId — 구독 이력이 없는 유저는 빈 배열을 반환한다 (T-005, seed-v4 AC-003)", async () => {
    const user = await createTestUser("find-all-empty");

    const all = await subscriptionRepository.findAllByUserId(user.id);

    expect(all).toEqual([]);
  });

  it("searchSubscribers — 검색어(email)로 필터링된다 (T-004, seed-v4 AC-002)", async () => {
    const target = await createTestUser("search-email-target");
    const other = await createTestUser("search-email-other");
    const now = new Date().toISOString();
    for (const user of [target, other]) {
      await subscriptionRepository.create({
        userId: user.id,
        plan: "monthly",
        amount: 9900,
        status: "active",
        trialEndAt: null,
        currentPeriodStart: now,
        currentPeriodEnd: now,
        nextBillingAt: now,
      });
    }

    const result = await subscriptionRepository.searchSubscribers({ search: target.email });

    expect(result.items.map((i) => i.userId)).toContain(target.id);
    expect(result.items.map((i) => i.userId)).not.toContain(other.id);
  });

  it("searchSubscribers — 검색어(name)로도 필터링된다 (T-004, seed-v4 AC-002)", async () => {
    const uniqueName = `검색이름테스트-${Date.now()}`;
    const target = await createNamedUser("search-name-target", uniqueName);
    const now = new Date().toISOString();
    await subscriptionRepository.create({
      userId: target.id,
      plan: "monthly",
      amount: 9900,
      status: "active",
      trialEndAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: now,
      nextBillingAt: now,
    });

    const result = await subscriptionRepository.searchSubscribers({ search: uniqueName });

    expect(result.items.map((i) => i.userId)).toContain(target.id);
    expect(result.items[0].name).toBe(uniqueName);
  });

  it("searchSubscribers — status 필터는 재구독 이력이 아니라 최신 건에만 적용된다 (T-004, seed-v4 AC-002)", async () => {
    const user = await createTestUser("search-status-latest");
    const now = new Date().toISOString();
    // 오래된(먼저 생성된) 이력: active
    await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "active",
      trialEndAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: now,
      nextBillingAt: now,
    });
    // 그 뒤 생성된(더 최신) 이력: canceled — 지금 실제 상태는 이쪽이다.
    await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "canceled",
      trialEndAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: now,
      nextBillingAt: null,
    });

    const activeFiltered = await subscriptionRepository.searchSubscribers({ search: user.email, status: "active" });
    const canceledFiltered = await subscriptionRepository.searchSubscribers({
      search: user.email,
      status: "canceled",
    });

    expect(activeFiltered.items.map((i) => i.userId)).not.toContain(user.id);
    expect(canceledFiltered.items.map((i) => i.userId)).toContain(user.id);
  });

  it("searchSubscribers — Subscription이 없는 User는 결과에서 빠진다 (T-004, seed-v4 AC-002)", async () => {
    const user = await createTestUser("search-no-subscription");

    const result = await subscriptionRepository.searchSubscribers({ search: user.email });

    expect(result.items).toHaveLength(0);
  });

  it("searchSubscribers — 페이지네이션 경계를 정확히 넘는다 (T-004, seed-v4 AC-002)", async () => {
    const marker = `page-boundary-${Date.now()}`;
    const now = new Date().toISOString();
    for (let i = 0; i < 21; i++) {
      const user = await createNamedUser(`page-boundary-${i}`, marker);
      await subscriptionRepository.create({
        userId: user.id,
        plan: "monthly",
        amount: 9900,
        status: "active",
        trialEndAt: null,
        currentPeriodStart: now,
        currentPeriodEnd: now,
        nextBillingAt: now,
      });
    }

    const page1 = await subscriptionRepository.searchSubscribers({ search: marker, page: 1 });
    const page2 = await subscriptionRepository.searchSubscribers({ search: marker, page: 2 });

    expect(page1.items).toHaveLength(20);
    expect(page2.items).toHaveLength(1);
    expect(page1.totalCount).toBe(21);
    expect(page2.totalCount).toBe(21);
  }, 30_000);

  it("countByStatus — 5개 상태 전부에 대해 숫자를 반환하고, 방금 만든 만큼(최소) 반영한다 (T-003, seed-v4 AC-001)", async () => {
    const user = await createTestUser("sub-count-status");
    const now = new Date().toISOString();
    await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "canceled",
      trialEndAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: now,
      nextBillingAt: null,
    });

    const counts = await subscriptionRepository.countByStatus();

    expect(Object.keys(counts).sort()).toEqual(["active", "canceled", "expired", "past_due", "trial"]);
    expect(counts.canceled).toBeGreaterThanOrEqual(1);
  });

  it("findDuplicateActiveGroups — 유효한 Subscription을 1건만 가진 유저는 잡히지 않는다 (T-007, seed-v4 AC-007)", async () => {
    const user = await createTestUser("sub-dup-single");
    const now = new Date().toISOString();
    await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "active",
      trialEndAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: now,
      nextBillingAt: now,
    });

    const groups = await subscriptionRepository.findDuplicateActiveGroups();

    expect(groups.some((g) => g.userId === user.id)).toBe(false);
  });

  it("findDuplicateActiveGroups — 동시에 유효한(trial/active/past_due) Subscription을 2건 이상 가진 유저만 그룹으로 반환한다 (T-007, seed-v4 AC-007)", async () => {
    const user = await createTestUser("sub-dup-multi");
    const now = new Date().toISOString();
    await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "active",
      trialEndAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: now,
      nextBillingAt: now,
    });
    // 정상 상태라면 있을 수 없는 상태지만(이론상 갭), 탐지 쿼리 자체를 검증하기
    // 위해 인위적으로 두 번째 유효 Subscription을 만든다.
    await subscriptionRepository.create({
      userId: user.id,
      plan: "yearly",
      amount: 99000,
      status: "past_due",
      trialEndAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: now,
      nextBillingAt: null,
    });

    const groups = await subscriptionRepository.findDuplicateActiveGroups();

    const group = groups.find((g) => g.userId === user.id);
    expect(group).toBeDefined();
    expect(group!.subscriptions).toHaveLength(2);
  });

  it("findDuplicateActiveGroups — canceled/expired만 여러 건이면 잡히지 않는다(유효 상태가 아님)", async () => {
    const user = await createTestUser("sub-dup-expired");
    const now = new Date().toISOString();
    await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "expired",
      trialEndAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: now,
      nextBillingAt: null,
    });
    await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "canceled",
      trialEndAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: now,
      nextBillingAt: null,
    });

    const groups = await subscriptionRepository.findDuplicateActiveGroups();

    expect(groups.some((g) => g.userId === user.id)).toBe(false);
  });
});
