import { afterEach, describe, expect, it } from "vitest";
import * as conversationRepository from "@/lib/data/conversation-repository";
import * as messageRepository from "@/lib/data/message-repository";
import * as userRepository from "@/lib/data/user-repository";
import * as agentPersonaRepository from "@/lib/data/agent-persona-repository";
import { createTestAuthUser, deleteTestAuthUser } from "./helpers";

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

describe("conversation/message-repository (통합, 로컬 Supabase)", () => {
  it("대화 생성 후 메시지 추가/최근 N건 조회 (시간순)", async () => {
    const userId = await makeUser("conv-user");
    const persona = await agentPersonaRepository.getByAgeBand("30s");
    const conversation = await conversationRepository.createConversation(userId, persona!.id);

    await messageRepository.appendMessage(conversation.id, "user", "안녕하세요");
    await messageRepository.appendMessage(conversation.id, "assistant", "안녕하세요! 무엇을 도와드릴까요?");
    await messageRepository.appendMessage(conversation.id, "user", "오늘 운동 기록 알려줘");

    const messages = await messageRepository.getRecentMessages(conversation.id, 10);
    expect(messages).toHaveLength(3);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]); // 시간 오름차순
  });

  it("존재하지 않는 conversation id 조회는 null", async () => {
    const result = await conversationRepository.getById("00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });
});
