// T-024 (seed-v4, AC-001, AC-004) — 어드민 대시보드 요약 화면 내용 E2E.
// 구독/결제 데이터는 다른 e2e 스펙과 동일하게 Data 레이어를 직접 호출해 만든다.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(import.meta.dirname, "../../.env.local") });

import { test, expect } from "@playwright/test";
import * as subscriptionRepository from "@/lib/data/subscription-repository";
import * as paymentAttemptRepository from "@/lib/data/payment-attempt-repository";
import { ensureAdminUser, createNonAdminUser, login, ADMIN_EMAIL } from "./_admin-fixtures";

async function textOfCardContaining(page: import("@playwright/test").Page, label: string) {
  return page.locator(".card", { hasText: label }).first().textContent();
}

function parseWonAmount(text: string | null): number {
  const match = text?.match(/([\d,]+)원/);
  if (!match) throw new Error(`금액 텍스트를 찾지 못함: ${text}`);
  return Number(match[1].replace(/,/g, ""));
}

test.describe("관리자 대시보드 요약 (AC-001, AC-004)", () => {
  test("서비스 통계와 구독 상태별 분포를 표시한다", async ({ page }) => {
    const user = await createNonAdminUser("admin-dash-stats");
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
    await page.goto("/admin");

    await expect(page.getByText("가입자 수")).toBeVisible();
    await expect(page.getByText("총 건강 기록 수")).toBeVisible();
    await expect(page.getByText("활성 케어링크 수")).toBeVisible();

    const activeRow = page.locator("tr", { hasText: "이용중" });
    const cellText = await activeRow.locator("td").nth(1).textContent();
    const activeCount = Number(cellText?.replace(/[^\d]/g, ""));
    expect(activeCount).toBeGreaterThanOrEqual(1);
  });

  test("이번 달 매출 합계는 방금 기록한 성공 결제만큼(최소) 반영되고, 데이터 없는 과거 달은 0원이다", async ({
    page,
  }) => {
    const user = await createNonAdminUser("admin-dash-revenue");
    const now = new Date().toISOString();
    const sub = await subscriptionRepository.create({
      userId: user.id,
      plan: "monthly",
      amount: 9900,
      status: "active",
      trialEndAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: now,
      nextBillingAt: now,
    });
    await paymentAttemptRepository.create({ subscriptionId: sub.id, result: "success", amount: 9900 });

    await ensureAdminUser();
    await login(page, ADMIN_EMAIL);

    await page.goto("/admin");
    const thisMonthText = await textOfCardContaining(page, "매출 합계");
    expect(parseWonAmount(thisMonthText)).toBeGreaterThanOrEqual(9900);

    await page.goto("/admin?month=2000-01");
    const pastMonthText = await textOfCardContaining(page, "매출 합계");
    expect(parseWonAmount(pastMonthText)).toBe(0);
  });
});
