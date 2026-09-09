// T-018 — 세션 게이트 E2E (AC-001)
import { test, expect } from "@playwright/test";
import { AUTH_COOKIE_NAME } from "@/proxy";

test.describe("middleware — 세션 게이트 (AC-001)", () => {
  test("쿠키 없이 보호된 경로(/dashboard) 접근 시 /login으로 리다이렉트된다", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("인증 쿠키가 있으면 보호된 경로에서 /login으로 리다이렉트되지 않는다", async ({ page, context }) => {
    await context.addCookies([
      {
        name: AUTH_COOKIE_NAME,
        value: "fake-token-for-e2e",
        url: "http://127.0.0.1:3100",
        httpOnly: true,
      },
    ]);

    await page.goto("/dashboard");
    await expect(page).not.toHaveURL(/\/login/);
  });

  for (const path of ["/", "/login", "/signup"]) {
    test(`공개 경로 ${path}는 쿠키 없이도 리다이렉트되지 않는다`, async ({ page }) => {
      await page.goto(path);
      // matcher 밖이라 미들웨어 자체가 실행되지 않으므로, 원래 요청한 경로에 그대로 머문다.
      await expect(page).toHaveURL(path === "/" ? /^http:\/\/127\.0\.0\.1:3100\/?$/ : new RegExp(path));
    });
  }
});
