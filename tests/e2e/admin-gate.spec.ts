// T-023, T-024, T-029 (seed-v4, AC-008) — /admin 접근 게이트 E2E.
// proxy.ts는 로그인 여부만 확인한다 — "로그인은 했지만 관리자가 아님"은
// 각 admin 페이지(app/admin/page.tsx)가 isAdminEmail로 재확인한다.
import { test, expect } from "@playwright/test";
import { ensureAdminUser, createNonAdminUser, login, ADMIN_EMAIL } from "./_admin-fixtures";

test.describe("proxy — /admin 세션 게이트 (AC-008)", () => {
  test("비로그인 상태로 /admin 접근 시 /login으로 리다이렉트된다", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("app/admin/page.tsx — 관리자 재확인 게이트 (AC-008)", () => {
  test("로그인했지만 관리자가 아닌 유저는 /admin 접근 시 /dashboard로 리다이렉트된다", async ({ page }) => {
    const { email } = await createNonAdminUser("admin-gate-nonadmin");
    await login(page, email);

    await page.goto("/admin");

    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("관리자(ADMIN_EMAIL)는 /admin에 정상 접근할 수 있다", async ({ page }) => {
    await ensureAdminUser();
    await login(page, ADMIN_EMAIL);

    await page.goto("/admin");

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "관리자 대시보드" })).toBeVisible();
  });
});

test.describe("AppShell — '관리자' 네비 링크 노출 (T-029, AC-001)", () => {
  test("비관리자는 대시보드 네비에 '관리자' 링크가 보이지 않는다", async ({ page }) => {
    const { email } = await createNonAdminUser("admin-nav-nonadmin");
    await login(page, email);

    await expect(page.getByRole("navigation").getByRole("link", { name: "관리자" })).toHaveCount(0);
  });

  test("관리자는 대시보드 네비에서도 '관리자' 링크로 /admin에 진입할 수 있다", async ({ page }) => {
    await ensureAdminUser();
    await login(page, ADMIN_EMAIL);

    const navLink = page.getByRole("navigation").getByRole("link", { name: "관리자" });
    await expect(navLink).toBeVisible();
    await navLink.click();
    await expect(page).toHaveURL(/\/admin$/);
  });
});
