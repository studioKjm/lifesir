// T-017, T-018 (seed-v3, AC-001) — /chat 구독 게이트 E2E.
// 실제 토스페이먼츠 카드 등록은 자동화 대상 밖이므로(seed-v3 non_goals와 동일한
// 이유로 매뉴얼 검증 대상), "trial/active 구독이 있는 유저" 상태는 Data 레이어를
// 직접 호출해 재현한다 — tests/e2e/onboarding-flow.spec.ts와 동일한 패턴.
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

async function giveSubscription(userId: string, status: SubscriptionStatus) {
  await paymentMethodRepository.create({ userId, billingKey: `test-billing-key-${userId}`, cardLast4: "1234" });
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  await subscriptionRepository.create({
    userId,
    plan: "monthly",
    amount: 9900,
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

test.describe("AI 코치 구독 게이트 (AC-001)", () => {
  test("구독 없는 유저는 /chat에서 안내만 보이고 ChatWindow는 없다", async ({ page }) => {
    const { email } = await createTestUser("gate-none");
    await login(page, email);

    await page.goto("/chat");

    await expect(page.getByText("AI 코치는 7일 무료체험 후 구독으로 계속 이용할 수 있어요.")).toBeVisible();
    await expect(page.getByRole("link", { name: "구독하기" })).toBeVisible();
    await expect(page.getByPlaceholder("메시지를 입력하세요")).toHaveCount(0);
  });

  test("구독 없는 유저가 /api/chat을 직접 호출하면 403이다 (페이지 게이트 우회 방지)", async ({ page }) => {
    const { email } = await createTestUser("gate-api");
    await login(page, email);

    const res = await page.request.post("/api/chat", { data: { content: "안녕" } });
    expect(res.status()).toBe(403);
  });

  test("trial 구독이 있는 유저는 정상적으로 AI 코치를 사용할 수 있다", async ({ page }) => {
    const { id, email } = await createTestUser("gate-trial");
    await giveSubscription(id, "trial");
    await login(page, email);

    await page.goto("/chat");

    await expect(page.getByPlaceholder("메시지를 입력하세요")).toBeVisible();
    await page.getByPlaceholder("메시지를 입력하세요").fill("안녕하세요");
    await page.getByRole("button", { name: "보내기" }).click();
    await expect(page.locator("[class*='bubbleAssistant']").last()).toBeVisible({ timeout: 15_000 });
  });

  test("past_due 구독인 유저는 차단되고 재구독 안내를 본다", async ({ page }) => {
    const { id, email } = await createTestUser("gate-pastdue");
    await giveSubscription(id, "past_due");
    await login(page, email);

    await page.goto("/chat");

    await expect(
      page.getByText("최근 결제에 실패해 AI 코치 이용이 중지됐어요. 재구독하면 다시 이용할 수 있어요.")
    ).toBeVisible();
    await expect(page.getByPlaceholder("메시지를 입력하세요")).toHaveCount(0);
  });
});
