// T-013, T-014 (seed-v2, AC-004) — 온보딩 E2E.
// 실제 구글 OAuth로 "agentPersonaId 없는 신규 유저"를 자동으로 만들 수 없으므로
// (구글 동의화면은 자동화 대상 밖), 같은 상태(생년월일/AgentPersona 없음)를
// Data 레이어를 직접 호출해 만든 뒤 이메일/비밀번호로 로그인해 재현한다 —
// tests/integration의 helpers.ts와 동일한 패턴.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(import.meta.dirname, "../../.env.local") });

import { test, expect } from "@playwright/test";
import { getSupabaseClient } from "@/lib/data/supabase-client";
import * as userRepository from "@/lib/data/user-repository";

const PASSWORD = "test-password-1234";

async function createUserNeedingOnboarding(prefix: string) {
  const email = `${prefix}-${Date.now()}@e2e.local`;
  const { data, error } = await getSupabaseClient().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`테스트 유저 생성 실패: ${error?.message}`);
  await userRepository.createUser({ id: data.user.id, email, name: "구글유저", agentPersonaId: null });
  return { id: data.user.id, email };
}

test.describe("온보딩 (AC-004)", () => {
  test("세션 없이 /onboarding 접근 시 /login으로 리다이렉트된다", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/login/);
  });

  test("AgentPersona 미매칭 유저는 대시보드에 온보딩 배너가 뜨고, 입력 후 사라진다", async ({ page }) => {
    const { email } = await createUserNeedingOnboarding("onboarding");

    await page.goto("/login");
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호").fill(PASSWORD);
    await page.getByRole("button", { name: "로그인" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // 배너가 보이고, 배너를 안 눌러도 대시보드 자체는 정상 사용 가능해야 한다(must 제약).
    await expect(page.getByText("생년월일을 입력하면 AI 코치가 연령대에 맞춰 답해드려요.")).toBeVisible();

    await page.getByRole("link", { name: "입력하기" }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.getByLabel("생년월일").fill("1995-05-05");
    await page.getByRole("button", { name: "시작하기" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText("생년월일을 입력하면 AI 코치가 연령대에 맞춰 답해드려요.")).not.toBeVisible();
  });

  test("이미 온보딩을 마친(agentPersonaId 있는) 유저가 /onboarding에 접근하면 /dashboard로 리다이렉트된다", async ({
    page,
  }) => {
    await page.goto("/signup");
    await page.getByLabel("이름").fill("이미완료");
    await page.getByLabel("생년월일").fill("1990-01-01");
    await page.getByLabel("이메일").fill(`already-onboarded-${Date.now()}@e2e.local`);
    await page.getByLabel("비밀번호").fill(PASSWORD);
    await page.getByRole("button", { name: "가입하고 시작하기" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
