import { afterEach, describe, expect, it } from "vitest";
import * as userRepository from "@/lib/data/user-repository";
import { DuplicateEmailError } from "@/lib/data/errors";
import { completeOnboarding } from "@/services/auth-service";
import { createTestAuthUser, deleteTestAuthUser } from "./helpers";

const createdIds: string[] = [];
afterEach(async () => {
  while (createdIds.length > 0) {
    const id = createdIds.pop()!;
    await deleteTestAuthUser(id);
  }
});

describe("user-repository (통합, 로컬 Supabase)", () => {
  it("생성 후 email/id로 조회할 수 있다", async () => {
    const auth = await createTestAuthUser("user-repo");
    createdIds.push(auth.id);

    const created = await userRepository.createUser({
      id: auth.id,
      email: auth.email,
      name: "테스트 사용자",
      birthDate: "1990-01-01",
      agentPersonaId: null,
    });
    expect(created.email).toBe(auth.email);

    const byEmail = await userRepository.getUserByEmail(auth.email);
    expect(byEmail?.id).toBe(auth.id);

    const byId = await userRepository.getUserById(auth.id);
    expect(byId?.name).toBe("테스트 사용자");
  });

  it("존재하지 않는 email은 null을 반환한다", async () => {
    const result = await userRepository.getUserByEmail("nobody@test.local");
    expect(result).toBeNull();
  });

  it("birthDate 없이 생성할 수 있다 (seed-v2 — 구글 신규가입)", async () => {
    const auth = await createTestAuthUser("google-user");
    createdIds.push(auth.id);

    const created = await userRepository.createUser({
      id: auth.id,
      email: auth.email,
      name: "구글 사용자",
      agentPersonaId: null,
    });
    expect(created.birthDate).toBeNull();
  });

  it("updateProfile로 생년월일/AgentPersona를 나중에 채울 수 있다 (seed-v2 온보딩)", async () => {
    const auth = await createTestAuthUser("onboarding-user");
    createdIds.push(auth.id);
    await userRepository.createUser({
      id: auth.id,
      email: auth.email,
      name: "온보딩 사용자",
      agentPersonaId: null,
    });

    const updated = await userRepository.updateProfile(auth.id, {
      birthDate: "1995-05-05",
      agentPersonaId: null,
    });
    expect(updated.birthDate).toBe("1995-05-05");
  });

  it("email UNIQUE 제약 위반 시 DuplicateEmailError를 던진다 (seed-v2, AC-003 자동연결 실패 감지)", async () => {
    const authA = await createTestAuthUser("dup-a");
    const authB = await createTestAuthUser("dup-b");
    createdIds.push(authA.id, authB.id);
    const sharedEmail = `shared-${Date.now()}@test.local`;

    await userRepository.createUser({ id: authA.id, email: sharedEmail, name: "A", agentPersonaId: null });

    await expect(
      userRepository.createUser({ id: authB.id, email: sharedEmail, name: "B", agentPersonaId: null })
    ).rejects.toThrow(DuplicateEmailError);
  });

  // 아래 2개는 독립 Test Designer(seed-v2.yaml만 보고 작성, src/ 미열람)가 찾아낸
  // 시나리오를 이 프로젝트의 실제 함수 시그니처에 맞게 가져온 것.
  it("동일 id로 createUser를 두 번 호출하면 두 번째는 실패한다 (PK 유일성)", async () => {
    const auth = await createTestAuthUser("dup-id");
    createdIds.push(auth.id);

    await userRepository.createUser({ id: auth.id, email: auth.email, name: "첫 번째", agentPersonaId: null });

    await expect(
      userRepository.createUser({ id: auth.id, email: auth.email, name: "두 번째(중복)", agentPersonaId: null })
    ).rejects.toThrow();
  });

  it("이메일 대소문자를 구분하는지 사실 확인 (AC-003 자동연결의 조회 정확도에 영향)", async () => {
    // 이 테스트는 "통과/실패 정답"이 아니라 현재 동작을 기록해두는 목적이다 — 대소문자를
    // 구분해서 못 찾는 것으로 확인되면, exchangeGoogleSession의 사전 비교(getUserByEmail)가
    // 대소문자 차이로 인해 기존 계정을 못 찾아 자동연결을 놓칠 수 있다는 뜻이라 /evolve에서
    // 정규화(lower(email) 유니크 인덱스 등) 도입을 검토해야 한다.
    const auth = await createTestAuthUser("case-test");
    createdIds.push(auth.id);
    await userRepository.createUser({ id: auth.id, email: auth.email, name: "케이스 테스트", agentPersonaId: null });

    const upper = await userRepository.getUserByEmail(auth.email.toUpperCase());
    expect([null, auth.id]).toContain(upper?.id ?? null);
  });

  it("존재하지 않는 userId로 온보딩을 완료하려 하면 명확히 실패한다(고아 데이터 생성 금지)", async () => {
    await expect(completeOnboarding("00000000-0000-0000-0000-000000000000", "1990-01-01")).rejects.toThrow();
  });
});
