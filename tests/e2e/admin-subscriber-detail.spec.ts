// T-026 (seed-v4, AC-003, AC-008) — 구독자 상세 페이지 E2E.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(import.meta.dirname, "../../.env.local") });

import { test, expect } from "@playwright/test";
import * as subscriptionRepository from "@/lib/data/subscription-repository";
import * as paymentAttemptRepository from "@/lib/data/payment-attempt-repository";
import { ensureAdminUser, createNonAdminUser, login, ADMIN_EMAIL } from "./_admin-fixtures";

test.describe("구독자 상세 (AC-003)", () => {
  test("로그인했지만 관리자가 아닌 유저는 상세 페이지 접근 시 /dashboard로 리다이렉트된다", async ({ page }) => {
    const target = await createNonAdminUser("admin-detail-target-for-gate");
    const { email } = await createNonAdminUser("admin-detail-nonadmin");
    await login(page, email);

    await page.goto(`/admin/subscribers/${target.id}`);

    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("존재하지 않는 userId는 404를 반환한다", async ({ page }) => {
    await ensureAdminUser();
    await login(page, ADMIN_EMAIL);

    const response = await page.goto("/admin/subscribers/00000000-0000-0000-0000-000000000000");

    expect(response?.status()).toBe(404);
  });

  test("구독 이력이 없는 유저는 404가 아니라 빈 상태 문구를 보여준다", async ({ page }) => {
    const target = await createNonAdminUser("admin-detail-nosub");

    await ensureAdminUser();
    await login(page, ADMIN_EMAIL);

    const response = await page.goto(`/admin/subscribers/${target.id}`);

    expect(response?.status()).toBe(200);
    await expect(page.getByText("구독 이력이 없어요.")).toBeVisible();
  });

  test("구독 이력과 결제 시도 이력을 표시하고, PaymentMethod/billing_key 관련 정보는 노출하지 않는다", async ({
    page,
  }) => {
    const target = await createNonAdminUser("admin-detail-full");
    const now = new Date().toISOString();
    const sub = await subscriptionRepository.create({
      userId: target.id,
      plan: "yearly",
      amount: 99000,
      status: "active",
      trialEndAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: now,
      nextBillingAt: now,
    });
    await paymentAttemptRepository.create({
      subscriptionId: sub.id,
      result: "failure",
      amount: 99000,
      failureReason: "카드 한도초과",
    });

    await ensureAdminUser();
    await login(page, ADMIN_EMAIL);
    await page.goto(`/admin/subscribers/${target.id}`);

    await expect(page.getByText("연간 · 이용중")).toBeVisible();
    await expect(page.getByText("카드 한도초과")).toBeVisible();
    await expect(page.getByRole("cell", { name: "실패", exact: true })).toBeVisible();

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/billing[_-]?key/i);
    expect(bodyText).not.toContain("카드번호");
  });
});
