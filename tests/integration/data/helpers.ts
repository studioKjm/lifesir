// 통합 테스트 공용 헬퍼 — 로컬 Supabase(Docker)에 실제 auth 유저를 만들고 정리한다.
import { getSupabaseClient } from "@/lib/data/supabase-client";

let counter = 0;

export async function createTestAuthUser(emailPrefix: string): Promise<{ id: string; email: string }> {
  counter += 1;
  const email = `${emailPrefix}-${Date.now()}-${counter}@test.local`;
  const { data, error } = await getSupabaseClient().auth.admin.createUser({
    email,
    password: "Test1234!",
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`테스트 auth user 생성 실패: ${error?.message}`);
  }
  return { id: data.user.id, email };
}

export async function deleteTestAuthUser(id: string): Promise<void> {
  await getSupabaseClient().auth.admin.deleteUser(id);
  // public.users는 auth.users FK의 on delete cascade로 함께 삭제된다.
}
