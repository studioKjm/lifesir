// T-021, T-022 (seed-v3, AC-010, AC-011) — 회귀 검증 전용 (low complexity,
// Direct 구현 — 코드 변경 없이 기존 기능이 구독 도입 이후에도 그대로인지만
// 확인한다).
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(import.meta.dirname, "../../.env.local") });

import { test, expect } from "@playwright/test";
import { getSupabaseClient } from "@/lib/data/supabase-client";
import * as userRepository from "@/lib/data/user-repository";
import * as subscriptionService from "@/services/subscription-service";

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

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe("건강 기록/케어링크는 구독과 무관하다 (AC-010)", () => {
  test("구독이 전혀 없는 유저도 /dashboard에 건강 기록을 남기고 /care-links로 연결 요청을 보낼 수 있다", async ({
    page,
  }) => {
    const target = await createTestUser("regress-target");
    const { email } = await createTestUser("regress-none");
    await login(page, email);

    // /dashboard — 구독 서비스가 이 페이지의 어떤 import에도 등장하지 않는다
    // (코드 레벨로도 확인됨) — 실제 기록 흐름이 여전히 동작하는지 E2E로 재확인.
    await page.goto("/dashboard");
    await page.getByLabel("값").fill("42");
    await page.getByLabel("단위 (선택)").fill("분");
    await page.getByRole("button", { name: "기록하기" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("cell", { name: "42분" })).toBeVisible();

    // /care-links — 마찬가지로 구독과 무관하게 정상 동작해야 한다.
    await page.goto("/care-links");
    await page.getByLabel("상대방 이메일").fill(target.email);
    await page.getByRole("button", { name: "연결 요청 보내기" }).click();
    await expect(page.getByText("응답 대기중")).toBeVisible();
  });
});

test.describe("기존 유저도 신규 유저와 동일한 규칙이 적용된다 (AC-011)", () => {
  test("가입 시점(created_at)과 무관하게 checkAICoachAccess가 동일하게 판정한다 — 소급 예외 없음", async () => {
    const recentUser = await createTestUser("regress-recent");
    const oldUser = await createTestUser("regress-old");

    // seed-v1/v2 시절 가입한 유저를 흉내 낸다 — public.users.created_at을 과거로
    // 직접 되돌린다(seed-v3 도입 훨씬 이전 시점). auth.users는 그대로 둔다 —
    // 로그인 자체는 seed-v3와 무관하다.
    const longAgo = new Date("2026-09-08T00:00:00Z").toISOString(); // seed-v1 최초 커밋 시점
    const { error } = await getSupabaseClient()
      .from("users")
      .update({ created_at: longAgo })
      .eq("id", oldUser.id);
    if (error) throw new Error(`created_at 백데이트 실패: ${error.message}`);

    // 둘 다 구독 이력이 전혀 없다 — checkAICoachAccess는 Subscription 테이블만
    // 보고 User.created_at은 아예 읽지 않는다(코드 레벨로 확인됨). 결과가
    // 완전히 동일해야 "가입 시점 기반 예외 로직이 없다"는 걸 실측으로 증명한다.
    const recentAccess = await subscriptionService.checkAICoachAccess(recentUser.id);
    const oldAccess = await subscriptionService.checkAICoachAccess(oldUser.id);

    expect(oldAccess).toEqual(recentAccess);
    expect(oldAccess).toEqual({ allowed: false, reason: "blocked:no_subscription" });
  });

  test("과거 가입 유저로 시뮬레이션한 계정도 /chat에서 동일하게 차단된다", async ({ page }) => {
    const { id, email } = await createTestUser("regress-old-chat");
    const longAgo = new Date("2026-09-08T00:00:00Z").toISOString();
    const { error } = await getSupabaseClient().from("users").update({ created_at: longAgo }).eq("id", id);
    if (error) throw new Error(`created_at 백데이트 실패: ${error.message}`);

    await login(page, email);
    await page.goto("/chat");

    await expect(page.getByRole("link", { name: "구독하기" })).toBeVisible();
    await expect(page.getByPlaceholder("메시지를 입력하세요")).toHaveCount(0);
  });
});
