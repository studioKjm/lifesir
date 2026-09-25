import { afterEach, describe, expect, it } from "vitest";
import * as paymentMethodRepository from "@/lib/data/payment-method-repository";
import * as userRepository from "@/lib/data/user-repository";
import { DuplicatePaymentMethodError } from "@/lib/data/errors";
import { createTestAuthUser, deleteTestAuthUser } from "./helpers";

const createdIds: string[] = [];
afterEach(async () => {
  while (createdIds.length > 0) {
    const id = createdIds.pop()!;
    await deleteTestAuthUser(id);
  }
});

async function createTestUser(prefix: string) {
  const auth = await createTestAuthUser(prefix);
  createdIds.push(auth.id);
  await userRepository.createUser({ id: auth.id, email: auth.email, name: "테스트 사용자", agentPersonaId: null });
  return auth;
}

describe("payment-method-repository (통합, 로컬 Supabase)", () => {
  it("생성 후 userId로 조회할 수 있다", async () => {
    const user = await createTestUser("pm-repo");

    const created = await paymentMethodRepository.create({
      userId: user.id,
      billingKey: "billing-key-abc",
      cardLast4: "1234",
    });
    expect(created.cardLast4).toBe("1234");

    const found = await paymentMethodRepository.findByUserId(user.id);
    expect(found?.billingKey).toBe("billing-key-abc");
  });

  it("존재하지 않는 userId는 null을 반환한다", async () => {
    const result = await paymentMethodRepository.findByUserId("00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });

  it("동일 userId로 2건째 생성 시 DuplicatePaymentMethodError (AC-003 불변식의 DB 최종 방어선)", async () => {
    const user = await createTestUser("pm-dup");
    await paymentMethodRepository.create({ userId: user.id, billingKey: "key-1", cardLast4: "1111" });

    await expect(
      paymentMethodRepository.create({ userId: user.id, billingKey: "key-2", cardLast4: "2222" })
    ).rejects.toBeInstanceOf(DuplicatePaymentMethodError);
  });

  it("deleteByUserId로 롤백할 수 있다 (Subscription 생성 실패 보상 롤백용)", async () => {
    const user = await createTestUser("pm-rollback");
    await paymentMethodRepository.create({ userId: user.id, billingKey: "key-1", cardLast4: "1111" });

    await paymentMethodRepository.deleteByUserId(user.id);

    expect(await paymentMethodRepository.findByUserId(user.id)).toBeNull();
  });
});
