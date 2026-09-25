// T-028 (seed-v4, AC-006, AC-008) — 구독 복구 Server Action E2E.
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

test.describe("구독 복구 (AC-006)", () => {
  test("recoverable 건을 복구하면 실제로 status=active + 다음 주기로 갱신되고, 방치 목록에서 사라진다", async ({
    page,
  }) => {
    const { user, sub } = await createStuckSubscription("admin-recover-success");
    await paymentAttemptRepository.create({ subscriptionId: sub.id, result: "success", amount: 9900 });

    await ensureAdminUser();
    await login(page, ADMIN_EMAIL);
    await page.goto("/admin/anomalies");

    const row = page.locator("tr", { has: page.locator(`a[href="/admin/subscribers/${user.id}"]`) });
    await row.getByRole("button", { name: "복구" }).click();

    await expect(page).toHaveURL(/notice=recovered$/);
    await expect(page.getByText("구독을 복구했어요.")).toBeVisible();
    // 복구됐으니 더 이상 방치 목록(이 유저의 href)에 나타나지 않는다.
    await expect(page.locator(`a[href="/admin/subscribers/${user.id}"]`)).toHaveCount(0);

    const updated = await subscriptionRepository.findById(sub.id);
    expect(updated?.status).toBe("active");
    expect(updated?.nextBillingAt).not.toBeNull();
    expect(new Date(updated!.currentPeriodEnd).getTime()).toBeGreaterThan(Date.now());
  });

  test("[UI 우회 차단] not_recoverable 구독의 id로 폼 데이터를 조작해 제출해도 서버가 거부하고 상태를 바꾸지 않는다", async ({
    page,
  }) => {
    // recoverable 폼(유효한 Server Action 참조)은 하나 필요하지만, 제출 직전
    // hidden input 값을 not_recoverable 구독의 id로 바꿔치기한다 — "화면엔
    // recoverable만 버튼이 있다"는 것과 무관하게, 실제 요청 페이로드를 조작해
    // 다른 id를 보내는 것과 동등한 시나리오(AC-006 "직접 API 호출 포함 차단").
    const { sub: recoverableSub } = await createStuckSubscription("admin-recover-bypass-valid");
    await paymentAttemptRepository.create({ subscriptionId: recoverableSub.id, result: "success", amount: 9900 });

    const { sub: notRecoverableSub } = await createStuckSubscription("admin-recover-bypass-target");
    await paymentAttemptRepository.create({
      subscriptionId: notRecoverableSub.id,
      result: "failure",
      amount: 9900,
      failureReason: "한도초과",
    });

    await ensureAdminUser();
    await login(page, ADMIN_EMAIL);
    await page.goto("/admin/anomalies");

    const form = page.locator("form", { has: page.getByRole("button", { name: "복구" }) }).first();
    await form.locator('input[name="subscriptionId"]').evaluate((el: HTMLInputElement, id: string) => {
      el.value = id;
    }, notRecoverableSub.id);
    await form.getByRole("button", { name: "복구" }).click();

    await expect(page).toHaveURL(/error=NOT_RECOVERABLE$/);

    const stillNotRecovered = await subscriptionRepository.findById(notRecoverableSub.id);
    // 복구가 실제로 일어났다면 nextBillingAt이 미래 값으로 채워지고
    // currentPeriodEnd도 갱신된다 — 둘 다 원래의 "방치" 상태 그대로라는 게
    // 서버가 갱신을 거부했다는 직접적인 증거다.
    expect(stillNotRecovered?.nextBillingAt).toBeNull();
    expect(new Date(stillNotRecovered!.currentPeriodEnd).getTime()).toBeLessThan(Date.now());
  });
});
