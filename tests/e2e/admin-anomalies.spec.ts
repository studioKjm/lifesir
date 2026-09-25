// T-027 (seed-v4, AC-005, AC-007, AC-008) — 이상 상태 탐지 페이지 E2E.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(import.meta.dirname, "../../.env.local") });

import { test, expect } from "@playwright/test";
import * as subscriptionRepository from "@/lib/data/subscription-repository";
import * as paymentAttemptRepository from "@/lib/data/payment-attempt-repository";
import { ensureAdminUser, createNonAdminUser, login, ADMIN_EMAIL } from "./_admin-fixtures";

const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

async function createStuckSubscription(prefix: string) {
  const user = await createNonAdminUser(prefix);
  const sub = await subscriptionRepository.create({
    userId: user.id,
    plan: "monthly",
    amount: 9900,
    status: "active",
    trialEndAt: null,
    currentPeriodStart: PAST,
    currentPeriodEnd: PAST,
    nextBillingAt: null,
  });
  return { user, sub };
}

test.describe("이상 상태 탐지 (AC-005, AC-007)", () => {
  test("로그인했지만 관리자가 아닌 유저는 /admin/anomalies 접근 시 /dashboard로 리다이렉트된다", async ({ page }) => {
    const { email } = await createNonAdminUser("admin-anomalies-nonadmin");
    await login(page, email);

    await page.goto("/admin/anomalies");

    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("recoverable 건은 '복구 가능' 배지와 활성화된(클릭 가능한) 복구 버튼을 보여준다", async ({ page }) => {
    const { user, sub } = await createStuckSubscription("admin-anomalies-recoverable");
    await paymentAttemptRepository.create({ subscriptionId: sub.id, result: "success", amount: 9900 });

    await ensureAdminUser();
    await login(page, ADMIN_EMAIL);
    await page.goto("/admin/anomalies");

    // 병렬로 실행되는 다른 테스트의 방치 구독 행과 섞이므로, 이 테스트가 만든
    // 유저의 상세 링크(href에 userId 포함)로 정확히 그 행만 찾는다.
    const row = page.locator("tr", { has: page.locator(`a[href="/admin/subscribers/${user.id}"]`) });
    await expect(row).toContainText("복구 가능");
    await expect(row.getByRole("button", { name: "복구" })).toBeEnabled();
  });

  test("not_recoverable 건은 '복구 불가' 배지를 보여주고 복구 버튼이 없다", async ({ page }) => {
    const { user, sub } = await createStuckSubscription("admin-anomalies-notrecoverable");
    await paymentAttemptRepository.create({ subscriptionId: sub.id, result: "failure", amount: 9900, failureReason: "한도초과" });

    await ensureAdminUser();
    await login(page, ADMIN_EMAIL);
    await page.goto("/admin/anomalies");

    const row = page.locator("tr", { has: page.locator(`a[href="/admin/subscribers/${user.id}"]`) });
    await expect(row).toContainText("복구 불가");
    await expect(row.getByRole("button", { name: "복구" })).toHaveCount(0);
  });

  test("undetermined 건(결제 시도 기록 자체가 없음)은 '판단 불가' 배지를 보여주고 복구 버튼이 없다", async ({
    page,
  }) => {
    const { user } = await createStuckSubscription("admin-anomalies-undetermined");
    // 결제 시도 기록을 일부러 만들지 않는다.

    await ensureAdminUser();
    await login(page, ADMIN_EMAIL);
    await page.goto("/admin/anomalies");

    const row = page.locator("tr", { has: page.locator(`a[href="/admin/subscribers/${user.id}"]`) });
    await expect(row).toContainText("판단 불가");
    await expect(row.getByRole("button", { name: "복구" })).toHaveCount(0);
  });

  test("중복으로 유효한 구독을 가진 유저를 목록으로 보여준다 (수정 기능 없음)", async ({ page }) => {
    const user = await createNonAdminUser("admin-anomalies-dup");
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

    await ensureAdminUser();
    await login(page, ADMIN_EMAIL);
    await page.goto("/admin/anomalies");

    await expect(page.getByText("중복으로 유효한 구독을 가진 유저")).toBeVisible();
    const row = page.locator("tr", { has: page.locator(`a[href="/admin/subscribers/${user.id}"]`) });
    await expect(row).toContainText("2건");
  });
});
