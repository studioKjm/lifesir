// seed-v4 어드민 E2E 공용 픽스처. 다른 e2e 스펙들과 달리 별도 파일로 뽑은
// 이유: ADMIN_EMAIL은 .env.local에 고정된 값이라(admin@e2e.local) 여러
// admin-*.spec.ts가 "이 정확한 이메일"을 공유해야 한다 — 매번 무작위 이메일을
// 만드는 기존 관례(createTestUser(prefix))로는 관리자 세션을 재현할 수 없다.
// ".spec." 을 파일명에 포함하지 않아 Playwright 테스트로 실행되지 않는다.
import { expect, type Page } from "@playwright/test";
import { getSupabaseClient } from "@/lib/data/supabase-client";
import * as userRepository from "@/lib/data/user-repository";

export const PASSWORD = "test-password-1234";
export const ADMIN_EMAIL = "admin@e2e.local";

/**
 * ADMIN_EMAIL 유저를 없으면 만들고, 있으면 재사용한다(테스트 간 공유 픽스처 —
 * afterEach에서 지우지 않는다). 여러 admin-*.spec.ts가 병렬 워커에서 동시에
 * 호출하면 둘 다 "없음"을 보고 동시에 생성을 시도하는 TOCTOU 레이스가 생길 수
 * 있다 — 이 세션 내내 다뤄온 이중 생성 레이스와 같은 계열이라, 진 쪽은 에러로
 * 죽지 않고 이긴 쪽이 만든 레코드를 다시 조회해 재사용한다.
 */
export async function ensureAdminUser(): Promise<{ id: string; email: string }> {
  const existing = await userRepository.getUserByEmail(ADMIN_EMAIL);
  if (existing) return { id: existing.id, email: existing.email };

  const { data, error } = await getSupabaseClient().auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    // 동시에 다른 워커가 먼저 만들었을 수 있다 — 재조회해서 있으면 그걸 쓴다.
    const wonByOther = await userRepository.getUserByEmail(ADMIN_EMAIL);
    if (wonByOther) return { id: wonByOther.id, email: wonByOther.email };
    throw new Error(`admin 테스트 유저 생성 실패: ${error?.message}`);
  }
  try {
    await userRepository.createUser({ id: data.user.id, email: ADMIN_EMAIL, name: "관리자", agentPersonaId: null });
  } catch {
    // public.users.email UNIQUE 위반 — 다른 워커의 auth 유저가 먼저 public.users에
    // 반영됐다는 뜻. 방금 만든 auth.users 레코드는 고아로 남지만(테스트 전용
    // 데이터라 무해), 이긴 쪽의 레코드를 재조회해 재사용한다.
    const wonByOther = await userRepository.getUserByEmail(ADMIN_EMAIL);
    if (wonByOther) return { id: wonByOther.id, email: wonByOther.email };
    throw new Error(`admin 테스트 유저의 public.users 반영 실패 및 재조회도 실패`);
  }
  return { id: data.user.id, email: ADMIN_EMAIL };
}

/** 무작위 이메일의 비관리자 테스트 유저 — 다른 e2e 스펙의 createTestUser(prefix)와 동일한 패턴. */
export async function createNonAdminUser(prefix: string): Promise<{ id: string; email: string }> {
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

export async function login(page: Page, email: string, password: string = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
