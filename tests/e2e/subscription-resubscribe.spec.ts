// T-016 (seed-v3, AC-008) — 재구독 E2E.
// "PaymentMethod는 있지만 유효 Subscription이 없는 유저" 상태는 Data 레이어를
// 직접 호출해 재현한다(tests/e2e/subscription-gate.spec.ts와 동일한 패턴,
// 실제 토스 결제 승인 자체는 자동화 밖 — 로컬 sandbox 키가 없으면 chargeBilling
// 호출이 실패하므로, 이 스펙은 TOSS_SECRET_KEY/NEXT_PUBLIC_TOSS_CLIENT_KEY가
// 채워져 있을 때만 청구 성공 케이스를 검증한다).
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

test.describe("재구독 (AC-008)", () => {
  test("past_due 유저는 재구독 폼을 볼 수 있다", async ({ page }) => {
    const { id, email } = await createTestUser("resub-form-pastdue");
    await giveSubscription(id, "past_due");
    await login(page, email);

    await page.goto("/subscription");

    await expect(
      page.getByText("최근 결제에 실패해 구독이 중지됐어요. 재구독하면 다시 이용할 수 있어요.")
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "재구독하기" })).toBeVisible();
  });

  test("canceled + 유예 중인 유저는 재구독 폼이 보이지 않는다 (남은 기간 우선)", async ({ page }) => {
    const { id, email } = await createTestUser("resub-grace");
    await giveSubscription(id, "trial"); // trial 생성 후 해지해 유예 상태를 만든다
    await login(page, email);

    await page.goto("/subscription");
    await page.getByRole("button", { name: "구독 해지" }).click();
    await expect(page).toHaveURL(/\/subscription$/);

    // AC-009 — 상태 표시가 "해지됨" 뱃지+플랜명+이용 가능 기한으로 바뀌었다.
    await expect(page.getByText("해지됨")).toBeVisible();
    await expect(page.getByText("이용 가능 기한:")).toBeVisible();
    await expect(page.getByRole("button", { name: "재구독하기" })).toHaveCount(0);
  });

  test("past_due 유저가 재구독하면 즉시 청구되고 active로 전환되며 /chat 접근이 복구된다", async ({ page }) => {
    test.skip(
      !process.env.TOSS_SECRET_KEY || !process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY,
      "TOSS_SECRET_KEY/NEXT_PUBLIC_TOSS_CLIENT_KEY 미설정 — 실제 청구 API 호출 불가(docs/toss-payments-setup.md 참고)"
    );

    const { id, email } = await createTestUser("resub-success");
    await giveSubscription(id, "past_due");
    await login(page, email);

    await page.goto("/subscription");
    await page.getByLabel("플랜").selectOption("monthly");
    await page.getByRole("button", { name: "재구독하기" }).click();

    await expect(page).toHaveURL(/\/subscription$/);
    await expect(page.getByText("현재 AI 코치를 이용 중이에요.")).toBeVisible();

    await page.goto("/chat");
    await expect(page.getByPlaceholder("메시지를 입력하세요")).toBeVisible();
  });
});
