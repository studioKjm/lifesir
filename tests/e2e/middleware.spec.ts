// T-018 — 세션 게이트 E2E (AC-001)
import { test, expect } from "@playwright/test";
import { AUTH_COOKIE_NAME } from "@/proxy";

test.describe("middleware — 세션 게이트 (AC-001)", () => {
  test("쿠키 없이 보호된 경로(/dashboard) 접근 시 /login으로 리다이렉트된다", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  // proxy.ts는 쿠키 "존재 여부"만 보는 얕은 UX 게이트라, 가짜 토큰이어도 통과시킨다.
  // 진짜 보안 경계는 각 페이지가 T-019(src/app/_lib/session.ts)로 토큰을 검증하는
  // 지점이다 — 가짜 토큰은 proxy를 통과해도 페이지 단에서 결국 /login으로 돌아간다.
  // (이 파일은 T-018 시점에는 "가짜 토큰이면 리다이렉트 안 됨"을 기대했지만, 그건
  // 당시 실제 토큰 검증이 아직 구현되지 않았던 상태였다 — T-019 구현 후 의도된
  // 동작에 맞춰 기대값을 갱신했다.)
  test("가짜 인증 쿠키는 proxy는 통과하지만 페이지 레벨 세션 검증에서 /login으로 돌려보낸다", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: AUTH_COOKIE_NAME,
        value: "fake-token-for-e2e",
        url: "http://127.0.0.1:3100",
        httpOnly: true,
      },
    ]);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  for (const path of ["/", "/login", "/signup"]) {
    test(`공개 경로 ${path}는 쿠키 없이도 리다이렉트되지 않는다`, async ({ page }) => {
      await page.goto(path);
      // matcher 밖이라 미들웨어 자체가 실행되지 않으므로, 원래 요청한 경로에 그대로 머문다.
      await expect(page).toHaveURL(path === "/" ? /^http:\/\/127\.0\.0\.1:3100\/?$/ : new RegExp(path));
    });
  }
});
