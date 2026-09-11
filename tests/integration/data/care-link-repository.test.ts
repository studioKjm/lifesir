import { afterEach, describe, expect, it } from "vitest";
import * as careLinkRepository from "@/lib/data/care-link-repository";
import { createTestAuthUser, deleteTestAuthUser } from "./helpers";
import * as userRepository from "@/lib/data/user-repository";

const createdIds: string[] = [];
afterEach(async () => {
  while (createdIds.length > 0) {
    const id = createdIds.pop()!;
    await deleteTestAuthUser(id);
  }
});

async function makeUser(prefix: string) {
  const auth = await createTestAuthUser(prefix);
  createdIds.push(auth.id);
  await userRepository.createUser({
    id: auth.id,
    email: auth.email,
    name: prefix,
    birthDate: "1990-01-01",
    agentPersonaId: null,
  });
  return auth.id;
}

describe("care-link-repository (통합, 로컬 Supabase)", () => {
  it("pending 생성 → accepted 갱신 → findBetween으로 상태 확인", async () => {
    const child = await makeUser("child");
    const parent = await makeUser("parent");

    const created = await careLinkRepository.create(child, parent);
    expect(created.status).toBe("pending");

    const updated = await careLinkRepository.updateStatus(created.id, "accepted");
    expect(updated.status).toBe("accepted");
    expect(updated.consentConfirmedAt).not.toBeNull();

    const found = await careLinkRepository.findBetween(parent, child); // 순서 반대로도 찾아짐
    expect(found?.id).toBe(created.id);
    expect(found?.status).toBe("accepted");
  });

  it("getPendingForUser는 대상자 기준 pending만 반환한다", async () => {
    const child = await makeUser("child2");
    const parent = await makeUser("parent2");
    await careLinkRepository.create(child, parent);

    const pending = await careLinkRepository.getPendingForUser(parent);
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending.every((c) => c.status === "pending")).toBe(true);
  });

  it("관계가 없으면 findBetween은 null을 반환한다", async () => {
    const a = await makeUser("lonely-a");
    const b = await makeUser("lonely-b");
    const result = await careLinkRepository.findBetween(a, b);
    expect(result).toBeNull();
  });

  it("getAllForUser는 요청자/대상자 방향과 무관하게 관련된 모든 링크를 반환한다 (T-020)", async () => {
    const child = await makeUser("child3");
    const parent = await makeUser("parent3");
    const stranger = await makeUser("stranger3");
    const created = await careLinkRepository.create(child, parent);
    await careLinkRepository.create(stranger, child);

    const forChild = await careLinkRepository.getAllForUser(child);
    expect(forChild.map((l) => l.id)).toContain(created.id);
    expect(forChild.length).toBeGreaterThanOrEqual(2);
  });
});
