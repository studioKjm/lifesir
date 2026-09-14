// T-015 (seed-v2, AC-006) — 로그아웃. 이메일 로그인/구글 로그인(시뮬레이션) 사용자
// 모두 동일한 signOut() 경로를 타므로(auth-service.ts 참고), 둘 다 확인한다.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(import.meta.dirname, "../../.env.local") });

import { test, expect } from "@playwright/test";
import { getSupabaseClient } from "@/lib/data/supabase-client";
import * as userRepository from "@/lib/data/user-repository";

const PASSWORD = "test-password-1234";

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}@e2e.local`;
}

test.describe("로그아웃 (AC-006)", () => {
  test("이메일 로그인 사용자 — 로그아웃 후 보호된 경로는 다시 /login으로 리다이렉트된다", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("이름").fill("로그아웃테스트");
    await page.getByLabel("생년월일").fill("1990-01-01");
    await page.getByLabel("이메일").fill(uniqueEmail("logout-email"));
    await page.getByLabel("비밀번호").fill(PASSWORD);
    await page.getByRole("button", { name: "가입하고 시작하기" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("button", { name: "로그아웃" }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("구글 로그인(시뮬레이션) 사용자 — 동일한 경로로 로그아웃되고 보호된 경로가 막힌다", async ({ page }) => {
    // AC-004 온보딩 테스트와 동일한 패턴 — agentPersonaId 없는 "구글 스타일" 유저를
    // Data 레이어로 직접 만들고 이메일/비밀번호로 로그인해 세션을 얻는다. AC-006이
    // 검증하려는 건 "세션이 어떻게 만들어졌는지와 무관하게 로그아웃이 동일하게
    // 동작하는가"이므로, 세션 자체는 정상 로그인으로 얻고 프로필 상태만 구글
    // 신규가입과 동일하게 맞춘다.
    const email = uniqueEmail("logout-google");
    const { data, error } = await getSupabaseClient().auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`테스트 유저 생성 실패: ${error?.message}`);
    await userRepository.createUser({ id: data.user.id, email, name: "구글유저", agentPersonaId: null });

    await page.goto("/login");
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호").fill(PASSWORD);
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("button", { name: "로그아웃" }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/chat");
    await expect(page).toHaveURL(/\/login/);
  });

  // Test Designer(독립 설계, seed-v2.yaml만 보고 작성)가 발견한 시나리오 —
  // bfcache/브라우저 캐시로 로그아웃 후에도 뒤로가기 시 이전 페이지가 그대로
  // 보일 수 있는 흔한 회귀 지점.
  test("로그아웃 후 브라우저 뒤로가기로 이전 보호된 페이지에 진입해도 /login으로 돌아간다", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("이름").fill("뒤로가기테스트");
    await page.getByLabel("생년월일").fill("1990-01-01");
    await page.getByLabel("이메일").fill(uniqueEmail("backnav"));
    await page.getByLabel("비밀번호").fill(PASSWORD);
    await page.getByRole("button", { name: "가입하고 시작하기" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("button", { name: "로그아웃" }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.goBack();
    await expect(page).toHaveURL(/\/login/);
  });
});
