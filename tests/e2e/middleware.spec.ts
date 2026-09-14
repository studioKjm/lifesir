// T-009 (seed-v2, AC-005) — 세션 게이트 E2E. @supabase/ssr 표준 방식으로 재작성됨 —
// AUTH_COOKIE_NAME 기반 커스텀 쿠키는 더 이상 존재하지 않는다.
import { test, expect } from "@playwright/test";

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}@e2e.local`;
}

test.describe("proxy — 세션 게이트 (AC-005)", () => {
  test("쿠키 없이 보호된 경로(/dashboard) 접근 시 /login으로 리다이렉트된다", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("조작된/유효하지 않은 세션 쿠키로도 /login으로 리다이렉트된다 (fail-closed)", async ({ page, context }) => {
    await context.addCookies([
      {
        name: "sb-127-auth-token",
        value: JSON.stringify({ access_token: "not-a-real-token", refresh_token: "also-fake" }),
        url: "http://127.0.0.1:3100",
        httpOnly: true,
      },
    ]);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("실제로 로그인한 세션이면 보호된 경로를 통과한다", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("이름").fill("게이트테스트");
    await page.getByLabel("생년월일").fill("1990-01-01");
    await page.getByLabel("이메일").fill(uniqueEmail("gate"));
    await page.getByLabel("비밀번호").fill("test-password-1234");
    await page.getByRole("button", { name: "가입하고 시작하기" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await page.reload();
    await expect(page).not.toHaveURL(/\/login/);
  });

  for (const path of ["/", "/login", "/signup"]) {
    test(`공개 경로 ${path}는 쿠키 없이도 리다이렉트되지 않는다`, async ({ page }) => {
      await page.goto(path);
      // matcher 밖이라 proxy 자체가 실행되지 않으므로, 원래 요청한 경로에 그대로 머문다.
      await expect(page).toHaveURL(path === "/" ? /^http:\/\/127\.0\.0\.1:3100\/?$/ : new RegExp(path));
    });
  }
});
