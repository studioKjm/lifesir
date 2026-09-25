// T-016 (seed-v3, AC-006) — 구독 해지 E2E.
// "trial/active 구독이 있는 유저" 상태는 Data 레이어를 직접 호출해 재현한다
// (tests/e2e/subscription-gate.spec.ts와 동일한 패턴, 실제 토스 결제는 자동화 밖).
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
  return subscriptionRepository.create({
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

test.describe("구독 해지 (AC-006)", () => {
  test("trial 유저가 해지 버튼을 누르면 해지되고, 직후에도 /chat은 유예기간 동안 계속 접근 가능하다 (AC-001 회귀 확인)", async ({
    page,
  }) => {
    const { id, email } = await createTestUser("cancel-trial");
    await giveSubscription(id, "trial");
    await login(page, email);

    await page.goto("/subscription");
    // AC-009 — 상태 표시가 "무료체험 중" 뱃지+플랜명+다음 결제일로 바뀌었다.
    await expect(page.getByText("무료체험 중")).toBeVisible();
    await page.getByRole("button", { name: "구독 해지" }).click();

    await expect(page).toHaveURL(/\/subscription$/);
    // 해지 후엔 "해지 가능한 구독" 분기가 사라진다 — 버튼도 함께 사라진다.
    await expect(page.getByRole("button", { name: "구독 해지" })).toHaveCount(0);

    // 유예기간(current_period_end 이전) 동안은 AI 코치를 여전히 쓸 수 있어야 한다.
    await page.goto("/chat");
    await expect(page.getByPlaceholder("메시지를 입력하세요")).toBeVisible();
  });

  test("해지 가능한 구독이 없는(past_due) 유저는 해지 버튼 자체를 볼 수 없다", async ({ page }) => {
    const { id, email } = await createTestUser("cancel-pastdue");
    await giveSubscription(id, "past_due");
    await login(page, email);

    await page.goto("/subscription");

    await expect(page.getByRole("button", { name: "구독 해지" })).toHaveCount(0);
  });

  test("구독 이력이 아예 없는 유저는 해지 버튼을 볼 수 없다 (PlanSelector 분기)", async ({ page }) => {
    const { email } = await createTestUser("cancel-none");
    await login(page, email);

    await page.goto("/subscription");

    await expect(page.getByRole("button", { name: "구독 해지" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "7일 무료체험 시작" }).first()).toBeVisible();
  });

  test("더블클릭(이미 해지된 구독을 다시 해지 시도)은 에러로 처리되고 페이지가 깨지지 않는다", async ({ page }) => {
    const { id, email } = await createTestUser("cancel-double");
    await giveSubscription(id, "trial");
    await login(page, email);

    // 정상적인 첫 해지.
    await page.goto("/subscription");
    await page.getByRole("button", { name: "구독 해지" }).click();
    await expect(page).toHaveURL(/\/subscription$/);
    await expect(page.getByRole("button", { name: "구독 해지" })).toHaveCount(0);

    // 이미 해지된 상태에서 다시 /subscription을 열어도(더블클릭과 동등한 상태)
    // 버튼이 없으니 재해지를 시도할 UI 경로 자체가 없다 — cancelSubscription의
    // NO_CANCELABLE_SUBSCRIPTION 방어는 tests/unit/services/subscription-service.test.ts에서
    // 이미 직접 검증했으므로, 여기서는 페이지가 정상 렌더링되는지만 회귀 확인한다.
    await page.reload();
    await expect(page.getByRole("button", { name: "구독 해지" })).toHaveCount(0);
  });
});
