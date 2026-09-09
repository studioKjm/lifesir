// T-013, T-017 — AI 에이전트 대화 (AC-008, AC-009)
// Pair Mode(Navigator Plan A)로 설계됨.
import * as conversationRepository from "@/lib/data/conversation-repository";
import * as messageRepository from "@/lib/data/message-repository";
import * as healthLogRepository from "@/lib/data/health-log-repository";
import * as agentPersonaRepository from "@/lib/data/agent-persona-repository";
import * as userRepository from "@/lib/data/user-repository";
import { generateReply, LLMError, type LLMMessage } from "@/lib/llm/llm-client";
import type { AgentPersonaRecord, HealthLogRecord, MessageRecord } from "@/lib/data/records";
import type { ChatMessageInput, MessageDTO } from "@/types/dto";

/**
 * AgentPersona의 tone과 system_prompt를 결합해 최종 시스템 프롬프트를 만든다.
 * system_prompt에 이미 페르소나 지시가 산문으로 녹아 있지만, tone은 그걸 요약한
 * 짧은 라벨이라 LLM이 놓치지 않도록 별도 지침 라인으로 재차 강조해 붙인다 (AC-009).
 */
export function buildSystemPrompt(persona: AgentPersonaRecord): string {
  return `${persona.systemPrompt}\n\n말투 지침: ${persona.tone}`;
}

export type ConversationErrorCode = "CONVERSATION_NOT_FOUND" | "NOT_OWNER" | "NO_PERSONA_MATCHED";

export class ConversationError extends Error {
  code: ConversationErrorCode;
  constructor(code: ConversationErrorCode, message: string) {
    super(message);
    this.name = "ConversationError";
    this.code = code;
  }
}

const RECENT_HEALTH_LOG_LIMIT = 5;
const RECENT_MESSAGE_HISTORY_LIMIT = 20;
const FALLBACK_MESSAGE = "죄송해요, 지금은 응답할 수 없어요. 잠시 후 다시 시도해주세요.";

function toMessageDTO(record: MessageRecord): MessageDTO {
  return {
    id: record.id,
    conversationId: record.conversationId,
    role: record.role,
    content: record.content,
    createdAt: record.createdAt,
  };
}

function formatHealthLogContext(logs: HealthLogRecord[]): string {
  if (logs.length === 0) return "최근 건강 기록 없음.";
  const lines = logs.map((log) => `- [${log.logType}] ${log.value}${log.unit ?? ""} (${log.loggedAt})`);
  return `최근 건강 기록:\n${lines.join("\n")}`;
}

async function resolveConversation(userId: string, conversationId: string | undefined) {
  if (conversationId) {
    const conversation = await conversationRepository.getById(conversationId);
    if (!conversation) {
      throw new ConversationError("CONVERSATION_NOT_FOUND", `대화를 찾을 수 없습니다 (id=${conversationId})`);
    }
    if (conversation.userId !== userId) {
      throw new ConversationError("NOT_OWNER", "이 대화에 접근할 권한이 없습니다");
    }
    return conversation;
  }

  const user = await userRepository.getUserById(userId);
  if (!user?.agentPersonaId) {
    throw new ConversationError("NO_PERSONA_MATCHED", `매칭된 AgentPersona가 없습니다 (userId=${userId})`);
  }
  return conversationRepository.createConversation(userId, user.agentPersonaId);
}

/**
 * AI 에이전트와 대화한다 (AC-008). HealthLog 컨텍스트는 매 호출 LLM 요청에만
 * 임시로 포함되고 별도 테이블에 저장되지 않는다 — "영구 저장/장기 학습 없음"
 * 제약은 대화 이력 자체가 아니라 이런 프로필 축적을 금지하는 것이다.
 * LLM 실패 시 폴백 메시지는 DB에 저장하지 않는다 — 저장하면 다음 턴 프롬프트
 * 히스토리에 "가짜 AI 응답"이 섞여 오염된다.
 */
export async function sendMessage(userId: string, input: ChatMessageInput): Promise<MessageDTO> {
  const conversation = await resolveConversation(userId, input.conversationId);

  await messageRepository.appendMessage(conversation.id, "user", input.content);

  const persona = await agentPersonaRepository.getById(conversation.agentPersonaId);
  if (!persona) {
    // FK(agent_persona_id NOT NULL)로 사실상 도달 불가능하지만, resolveConversation의
    // NO_PERSONA_MATCHED와 동일하게 명시적으로 처리한다 (Navigator 리뷰 — 조용한
    // 성능 저하 대신 일관된 에러로 통일).
    throw new ConversationError(
      "NO_PERSONA_MATCHED",
      `AgentPersona를 찾을 수 없습니다 (id=${conversation.agentPersonaId})`
    );
  }
  const basePrompt = buildSystemPrompt(persona);

  const recentLogs = await healthLogRepository.getRecentLogsForUser(userId, RECENT_HEALTH_LOG_LIMIT);
  const systemPromptWithContext = `${basePrompt}\n\n${formatHealthLogContext(recentLogs)}`;

  const history = await messageRepository.getRecentMessages(conversation.id, RECENT_MESSAGE_HISTORY_LIMIT);
  const llmMessages: LLMMessage[] = history
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  try {
    const reply = await generateReply(systemPromptWithContext, llmMessages);
    const saved = await messageRepository.appendMessage(conversation.id, "assistant", reply);
    return toMessageDTO(saved);
  } catch (err) {
    if (err instanceof LLMError) {
      return {
        id: crypto.randomUUID(),
        conversationId: conversation.id,
        role: "assistant",
        content: FALLBACK_MESSAGE,
        createdAt: new Date().toISOString(),
      };
    }
    throw err;
  }
}
