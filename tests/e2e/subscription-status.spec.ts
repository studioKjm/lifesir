// T-014 (seed-v3, AC-009) — 구독 상태 전체 조회 UI E2E.
// "trial/active/past_due/canceled+유예" 상태는 Data 레이어를 직접 호출해
// 재현한다(tests/e2e/subscription-gate.spec.ts와 동일한 패턴).
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(import.meta.dirname, "../../.env.local") });

import { test, expect } from "@playwright/test";
import { getSupabaseClient } from "@/lib/data/supabase-client";
import * as userRepository from "@/lib/data/user-repository";
import * as paymentMethodRepository from "@/lib/data/payment-method-repository";
import * as subscriptionRepository from "@/lib/data/subscription-repository";
import type { SubscriptionStatus } from "@/types/dto";

const PASSWORD = "test-password-1234";

async function createTestUser(prefix: string) {
  const email = `${prefix}-${Date.now()}@e2e.local`;
  const { data, error } = await getSupabaseClient().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`테스트 유저 생성 실패: ${error?.message}`);
  await userRepository.createUser({ id: data.user.id, email, name: "테스트유저", agentPersonaId: null });
  return { id: data.user.id, email };
}

async function giveSubscription(userId: string, status: SubscriptionStatus, plan: "monthly" | "yearly" = "monthly") {
  await paymentMethodRepository.create({ userId, billingKey: `test-billing-key-${userId}`, cardLast4: "1234" });
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return subscriptionRepository.create({
    userId,
    plan,
    amount: plan === "monthly" ? 9900 : 99000,
    status,
    trialEndAt: status === "trial" ? periodEnd.toISOString() : null,
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: periodEnd.toISOString(),
    nextBillingAt: periodEnd.toISOString(),
  });
}

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe("구독 상태 조회 (AC-009)", () => {
  test("AppShell 상단 네비의 '구독' 링크로 /subscription에 진입할 수 있다", async ({ page }) => {
    const { email } = await createTestUser("status-nav");
    await login(page, email);

    await page.getByRole("link", { name: "구독" }).click();

    await expect(page).toHaveURL(/\/subscription$/);
    await expect(page.getByRole("heading", { name: "구독 관리" })).toBeVisible();
  });

  test("active 유저는 연간 플랜명과 다음 결제일을 확인할 수 있다", async ({ page }) => {
    const { id, email } = await createTestUser("status-active");
    await giveSubscription(id, "active", "yearly");
    await login(page, email);

    await page.goto("/subscription");

    await expect(page.getByText("이용 중")).toBeVisible();
    await expect(page.getByText("연간 플랜")).toBeVisible();
    await expect(page.getByText("다음 결제일:")).toBeVisible();
  });

  test("past_due 유저는 날짜 없이 결제 실패 상태만 표시된다", async ({ page }) => {
    const { id, email } = await createTestUser("status-pastdue");
    await giveSubscription(id, "past_due", "monthly");
    await login(page, email);

    await page.goto("/subscription");

    await expect(page.getByText("결제 실패")).toBeVisible();
    await expect(page.getByText("월간 플랜")).toBeVisible();
    // past_due는 보여줄 날짜가 없다(Navigator Plan A) — "다음 결제일:"/"만료일:" 둘 다 없어야 한다.
    await expect(page.getByText("다음 결제일:")).toHaveCount(0);
    await expect(page.getByText("만료일:")).toHaveCount(0);
  });

  test("구독 이력이 없는 유저는 플랜 선택 화면을 본다", async ({ page }) => {
    const { email } = await createTestUser("status-none");
    await login(page, email);

    await page.goto("/subscription");

    await expect(page.getByRole("button", { name: "7일 무료체험 시작" }).first()).toBeVisible();
  });
});
