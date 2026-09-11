// T-025 — AC-011 전체 플로우 E2E + AC-010(신규 사용자 빈 상태) + AC-004(미승인 접근 거부).
// 로컬 Supabase(도커)가 실행 중이어야 한다 — `supabase start` 후 `npm run test:e2e`.
import { test, expect, type Page } from "@playwright/test";

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}@e2e.local`;
}

async function signUp(page: Page, opts: { name: string; email: string; birthDate: string }) {
  await page.goto("/signup");
  await page.getByLabel("이름").fill(opts.name);
  await page.getByLabel("생년월일").fill(opts.birthDate);
  await page.getByLabel("이메일").fill(opts.email);
  await page.getByLabel("비밀번호").fill("test-password-1234");
  await page.getByRole("button", { name: "가입하고 시작하기" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.describe("전체 플로우 (AC-011)", () => {
  test("회원가입 → 신규 사용자 빈 상태(AC-010) → HealthLog 기록(AC-005) → 대시보드 반영(AC-006) → AI 대화(AC-008)", async ({
    page,
  }) => {
    await signUp(page, { name: "테스트유저", email: uniqueEmail("solo"), birthDate: "1990-05-01" });

    // AC-010 — 신규 사용자는 기록이 없다는 빈 상태를 본다.
    await expect(page.getByText("아직 기록이 없어요")).toBeVisible();

    // AC-005 — 본인 HealthLog 기록.
    await page.getByLabel("값").fill("30");
    await page.getByLabel("단위 (선택)").fill("분");
    await page.getByRole("button", { name: "기록하기" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // AC-006 — 대시보드에 즉시 반영된다 (요약 타일 "최근 30분"과 기록 테이블 셀 둘 다에 나타난다).
    await expect(page.getByRole("cell", { name: "30분" })).toBeVisible();

    // AC-008 — AI 코치와 대화.
    await page.goto("/chat");
    await page.getByPlaceholder("메시지를 입력하세요").fill("오늘 컨디션 어때 보여?");
    await page.getByRole("button", { name: "보내기" }).click();
    await expect(page.locator(".bubbleRowUser, [class*='bubbleRowUser']").last()).toBeVisible();
    // LLM 키가 없는 로컬 환경에서도 서비스가 폴백 메시지로 응답하므로, 어떤 형태로든 답장 버블이 생긴다.
    await expect(page.locator("[class*='bubbleAssistant']").last()).toBeVisible({ timeout: 15_000 });
  });

  test("CareLink 요청→수락(AC-003) 후에만 자녀가 부모 대시보드를 볼 수 있다(AC-004, AC-007)", async ({ browser }) => {
    const parentEmail = uniqueEmail("parent");
    const childEmail = uniqueEmail("child");

    const parentContext = await browser.newContext();
    const parentPage = await parentContext.newPage();
    await signUp(parentPage, { name: "부모", email: parentEmail, birthDate: "1970-01-01" });
    await parentPage.getByLabel("값").fill("58.2");
    await parentPage.getByLabel("단위 (선택)").fill("kg");
    await parentPage.getByRole("button", { name: "기록하기" }).click();

    const childContext = await browser.newContext();
    const childPage = await childContext.newPage();
    await signUp(childPage, { name: "자녀", email: childEmail, birthDate: "2000-01-01" });

    // 자녀가 부모에게 연결을 요청한다.
    await childPage.goto("/care-links");
    await childPage.getByLabel("상대방 이메일").fill(parentEmail);
    await childPage.getByRole("button", { name: "연결 요청 보내기" }).click();
    await expect(childPage.getByText("응답 대기중")).toBeVisible();

    // 부모가 수락하기 전까지는 자녀가 대시보드를 볼 수 없다 — 목록에 "대시보드 보기" 링크가 없다.
    await expect(childPage.getByRole("link", { name: "대시보드 보기" })).toHaveCount(0);

    // 부모가 수락한다.
    await parentPage.goto("/care-links");
    await parentPage.getByRole("button", { name: "수락" }).click();
    await expect(parentPage.getByText("내 기록 열람 허용됨")).toBeVisible();

    // AC-007 — 이제 자녀가 부모의 대시보드를 읽기 전용으로 볼 수 있다.
    await childPage.goto("/care-links");
    await childPage.getByRole("link", { name: "대시보드 보기" }).click();
    await expect(childPage.getByRole("cell", { name: "58.2kg" })).toBeVisible();
    await expect(childPage.getByText("15초마다 자동 갱신")).toBeVisible();
    const parentDashboardUrl = childPage.url(); // 이 시점엔 /dashboard/[careLinkId]로 내비게이션이 끝나 있다.

    // AC-005 — 자녀가 부모를 대신해 대리 입력할 수 있다.
    await expect(childPage.getByRole("heading", { name: "부모님 대신 기록하기" })).toBeVisible();
    await childPage.getByLabel("종류").selectOption("exercise");
    await childPage.getByLabel("값").fill("20");
    await childPage.getByLabel("단위 (선택)").fill("분");
    await childPage.getByRole("button", { name: "기록하기" }).click();
    await expect(childPage).toHaveURL(parentDashboardUrl);
    await expect(childPage.getByRole("cell", { name: "20분" })).toBeVisible();

    await parentContext.close();
    await childContext.close();
  });

  test("AC-004 — 존재하지 않는 CareLink로 부모 대시보드에 직접 접근하면 404를 반환한다", async ({ page }) => {
    await signUp(page, { name: "단독유저", email: uniqueEmail("lonely"), birthDate: "1995-01-01" });
    const res = await page.goto("/dashboard/00000000-0000-0000-0000-000000000000");
    expect(res?.status()).toBe(404);
  });
});
