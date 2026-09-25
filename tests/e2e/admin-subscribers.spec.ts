// T-025 (seed-v4, AC-002, AC-008) — 구독자 목록 페이지 E2E.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(import.meta.dirname, "../../.env.local") });

import { test, expect } from "@playwright/test";
import * as subscriptionRepository from "@/lib/data/subscription-repository";
import { ensureAdminUser, createNonAdminUser, login, ADMIN_EMAIL } from "./_admin-fixtures";

test.describe("구독자 목록 (AC-002)", () => {
  test("로그인했지만 관리자가 아닌 유저는 /admin/subscribers 접근 시 /dashboard로 리다이렉트된다", async ({ page }) => {
    const { email } = await createNonAdminUser("admin-subs-nonadmin");
    await login(page, email);

    await page.goto("/admin/subscribers");

    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("검색어(email)로 구독자를 찾을 수 있다", async ({ page }) => {
    const user = await createNonAdminUser("admin-subs-search");
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

    await ensureAdminUser();
    await login(page, ADMIN_EMAIL);
    await page.goto(`/admin/subscribers?search=${encodeURIComponent(user.email)}`);

    await expect(page.getByText(user.email)).toBeVisible();
  });

  test("Subscription이 없는 유저는 검색해도 목록에 나타나지 않는다", async ({ page }) => {
    const user = await createNonAdminUser("admin-subs-nosub");

    await ensureAdminUser();
    await login(page, ADMIN_EMAIL);
    await page.goto(`/admin/subscribers?search=${encodeURIComponent(user.email)}`);

    await expect(page.getByText(user.email)).toHaveCount(0);
    await expect(page.getByText("조건에 맞는 구독자가 없어요.")).toBeVisible();
  });

  test("상태 필터를 적용하면 다른 상태의 구독자는 검색 결과에서 빠진다", async ({ page }) => {
    const user = await createNonAdminUser("admin-subs-statusfilter");
    const now = new Date().toISOString();
    await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "past_due",
      trialEndAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: now,
      nextBillingAt: null,
    });

    await ensureAdminUser();
    await login(page, ADMIN_EMAIL);

    await page.goto(`/admin/subscribers?search=${encodeURIComponent(user.email)}&status=active`);
    await expect(page.getByText(user.email)).toHaveCount(0);

    await page.goto(`/admin/subscribers?search=${encodeURIComponent(user.email)}&status=past_due`);
    await expect(page.getByText(user.email)).toBeVisible();
  });
});
