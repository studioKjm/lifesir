// T-012, T-016 (seed-v2) — 구글 OAuth 콜백 E2E. 실제 구글 동의화면은 자동화
// 대상 밖이다(seed-v2 non_goals) — 콜백 라우트 자체의 리다이렉트 분기만 검증한다.
// 실제 구글 계정으로의 수동 검증은
// .harness/ouroboros/tasks/seed-v2-decomposition.yaml의
// manual_verification_checklist를 참고.
import { test, expect } from "@playwright/test";

test.describe("구글 OAuth 콜백 (AC-001, AC-003, AC-007)", () => {
  test("code 파라미터 없이 콜백에 도달하면(취소) /login?error=OAUTH_CANCELLED로 리다이렉트된다", async ({ page }) => {
    await page.goto("/auth/callback");
    await expect(page).toHaveURL(/\/login\?error=OAUTH_CANCELLED/);
    await expect(page.getByText("구글 로그인이 취소됐어요.")).toBeVisible();
  });

  test("유효하지 않은 code로 콜백에 도달하면 /login?error=OAUTH_EXCHANGE_FAILED로 리다이렉트된다", async ({ page }) => {
    await page.goto("/auth/callback?code=this-is-not-a-real-authorization-code");
    await expect(page).toHaveURL(/\/login\?error=OAUTH_EXCHANGE_FAILED/);
    await expect(page.getByText("구글 로그인에 실패했어요.")).toBeVisible();
  });
});
