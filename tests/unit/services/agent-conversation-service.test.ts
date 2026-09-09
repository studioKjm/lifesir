import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildSystemPrompt, sendMessage, ConversationError } from "@/services/agent-conversation-service";
import * as conversationRepository from "@/lib/data/conversation-repository";
import * as messageRepository from "@/lib/data/message-repository";
import * as healthLogRepository from "@/lib/data/health-log-repository";
import * as agentPersonaRepository from "@/lib/data/agent-persona-repository";
import * as userRepository from "@/lib/data/user-repository";
import { generateReply, LLMError } from "@/lib/llm/llm-client";
import type { AgentPersonaRecord, ConversationRecord, HealthLogRecord, MessageRecord, UserRecord } from "@/lib/data/records";

vi.mock("@/lib/data/conversation-repository");
vi.mock("@/lib/data/message-repository");
vi.mock("@/lib/data/health-log-repository");
vi.mock("@/lib/data/agent-persona-repository");
vi.mock("@/lib/data/user-repository");
// generateReply만 mock하고 LLMError는 실제 클래스를 유지한다
// (서비스 코드의 `err instanceof LLMError` 판별이 실제로 검증되도록).
vi.mock("@/lib/llm/llm-client", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/llm/llm-client")>();
  return { ...actual, generateReply: vi.fn() };
});

function persona(overrides: Partial<AgentPersonaRecord>): AgentPersonaRecord {
  return {
    id: "p1",
    ageBand: "30s",
    tone: "균형 잡힌 전문적인 톤",
    systemPrompt: "당신은 30대 사용자를 위한 건강 코치입니다.",
    ...overrides,
  };
}

describe("buildSystemPrompt (AC-009)", () => {
  it("systemPrompt와 tone을 모두 결과 문자열에 포함한다", () => {
    const p = persona({});
    const result = buildSystemPrompt(p);
    expect(result).toContain(p.systemPrompt);
    expect(result).toContain(p.tone);
  });

  it("persona가 다르면 출력도 달라진다 (연령대별 어투 반영, AC-009)", () => {
    const teen = persona({
      ageBand: "10s",
      tone: "친근하고 격려하는 반말 섞인 톤",
      systemPrompt: "당신은 10대 사용자를 위한 건강 코치입니다.",
    });
    const senior = persona({
      ageBand: "50s_plus",
      tone: "정중하고 세심한 존댓말 톤",
      systemPrompt: "당신은 50대 이상 사용자를 위한 건강 코치입니다.",
    });

    expect(buildSystemPrompt(teen)).not.toBe(buildSystemPrompt(senior));
  });
});

function conversation(overrides: Partial<ConversationRecord>): ConversationRecord {
  return {
    id: "conv-1",
    userId: "u1",
    agentPersonaId: "p1",
    startedAt: "2026-09-09T00:00:00Z",
    ...overrides,
  };
}

function messageRecord(overrides: Partial<MessageRecord>): MessageRecord {
  return {
    id: "m1",
    conversationId: "conv-1",
    role: "user",
    content: "hi",
    createdAt: "2026-09-09T00:00:00Z",
    ...overrides,
  };
}

function user(overrides: Partial<UserRecord>): UserRecord {
  return {
    id: "u1",
    email: "u1@test.local",
    name: "U1",
    birthDate: "1990-01-01",
    agentPersonaId: "p1",
    createdAt: "2026-09-09T00:00:00Z",
    ...overrides,
  };
}

function healthLogRecord(overrides: Partial<HealthLogRecord>): HealthLogRecord {
  return {
    id: "h1",
    userId: "u1",
    loggedByUserId: "u1",
    logType: "sleep",
    value: "6",
    unit: "시간",
    loggedAt: "2026-09-09T00:00:00Z",
    note: null,
    createdAt: "2026-09-09T00:00:00Z",
    ...overrides,
  };
}

describe("sendMessage (AC-008)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(agentPersonaRepository.getById).mockResolvedValue(persona({}));
    vi.mocked(healthLogRepository.getRecentLogsForUser).mockResolvedValue([]);
    vi.mocked(messageRepository.getRecentMessages).mockResolvedValue([]);
  });

  it("conversationId 없으면 새 대화를 생성하고 응답 DTO에 conversationId를 포함한다", async () => {
    vi.mocked(userRepository.getUserById).mockResolvedValue(user({}));
    vi.mocked(conversationRepository.createConversation).mockResolvedValue(conversation({}));
    vi.mocked(messageRepository.appendMessage)
      .mockResolvedValueOnce(messageRecord({ id: "u-msg", role: "user", content: "hi" }))
      .mockResolvedValueOnce(messageRecord({ id: "a-msg", role: "assistant", content: "안녕하세요" }));
    vi.mocked(generateReply).mockResolvedValue("안녕하세요");

    const result = await sendMessage("u1", { content: "hi" });

    expect(conversationRepository.createConversation).toHaveBeenCalledWith("u1", "p1");
    expect(result.conversationId).toBe("conv-1");
    expect(result.content).toBe("안녕하세요");
    expect(result.role).toBe("assistant");
  });

  it("conversationId가 있으면 기존 대화를 재사용한다 (본인 소유)", async () => {
    vi.mocked(conversationRepository.getById).mockResolvedValue(conversation({ userId: "u1" }));
    vi.mocked(messageRepository.appendMessage)
      .mockResolvedValueOnce(messageRecord({ role: "user" }))
      .mockResolvedValueOnce(messageRecord({ id: "a-msg", role: "assistant", content: "계속할게요" }));
    vi.mocked(generateReply).mockResolvedValue("계속할게요");

    const result = await sendMessage("u1", { conversationId: "conv-1", content: "다음 질문" });

    expect(conversationRepository.createConversation).not.toHaveBeenCalled();
    expect(result.content).toBe("계속할게요");
  });

  it("타인의 대화에 접근하면 NOT_OWNER를 던지고 메시지를 저장하지 않는다", async () => {
    vi.mocked(conversationRepository.getById).mockResolvedValue(conversation({ userId: "someone-else" }));

    await expect(sendMessage("u1", { conversationId: "conv-1", content: "hi" })).rejects.toMatchObject({
      code: "NOT_OWNER",
    });
    expect(messageRepository.appendMessage).not.toHaveBeenCalled();
  });

  it("존재하지 않는 conversationId는 CONVERSATION_NOT_FOUND", async () => {
    vi.mocked(conversationRepository.getById).mockResolvedValue(null);

    await expect(sendMessage("u1", { conversationId: "missing", content: "hi" })).rejects.toMatchObject({
      code: "CONVERSATION_NOT_FOUND",
    });
  });

  it("매칭된 persona가 없으면 새 대화를 시작할 수 없다 (NO_PERSONA_MATCHED)", async () => {
    vi.mocked(userRepository.getUserById).mockResolvedValue(user({ agentPersonaId: null }));

    await expect(sendMessage("u1", { content: "hi" })).rejects.toMatchObject({
      code: "NO_PERSONA_MATCHED",
    });
    expect(messageRepository.appendMessage).not.toHaveBeenCalled();
  });

  it("LLM 호출 실패 시 폴백 메시지를 반환하고, assistant 메시지는 저장하지 않는다 (user 메시지만 1회 저장)", async () => {
    vi.mocked(conversationRepository.getById).mockResolvedValue(conversation({ userId: "u1" }));
    vi.mocked(messageRepository.appendMessage).mockResolvedValue(messageRecord({ role: "user" }));
    vi.mocked(generateReply).mockRejectedValue(new LLMError("LLM 응답 생성에 실패했습니다"));

    const result = await sendMessage("u1", { conversationId: "conv-1", content: "hi" });

    expect(result.role).toBe("assistant");
    expect(result.content).toMatch(/잠시 후 다시 시도/);
    expect(messageRepository.appendMessage).toHaveBeenCalledTimes(1); // user 메시지만
    expect(messageRepository.appendMessage).not.toHaveBeenCalledWith("conv-1", "assistant", expect.anything());
  });

  it("최근 HealthLog가 LLM 호출의 systemPrompt 컨텍스트에 실제로 포함된다 (Test Designer 발견 — 배선 누락 여부 검증)", async () => {
    vi.mocked(conversationRepository.getById).mockResolvedValue(conversation({ userId: "u1" }));
    vi.mocked(healthLogRepository.getRecentLogsForUser).mockResolvedValue([
      healthLogRecord({ logType: "sleep", value: "6", unit: "시간" }),
    ]);
    vi.mocked(messageRepository.appendMessage).mockResolvedValue(messageRecord({ role: "assistant" }));
    vi.mocked(generateReply).mockResolvedValue("잠을 조금 더 주무시는 게 좋겠어요.");

    await sendMessage("u1", { conversationId: "conv-1", content: "요즘 계속 피곤해" });

    const [systemPromptArg] = vi.mocked(generateReply).mock.calls[0];
    expect(systemPromptArg).toContain("sleep");
  });
});
