import { afterEach, describe, expect, it } from "vitest";
import * as userRepository from "@/lib/data/user-repository";
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
});
