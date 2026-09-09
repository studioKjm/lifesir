// Data 레이어 레코드 타입 (Logic↔Data 경계에서 그대로 재사용 — seed-v1 tech_decisions).
// DB 컬럼은 snake_case, 레코드는 camelCase로 매핑해 반환한다.
import type { AgeBand, CareLinkStatus, HealthLogType, MessageRole } from "@/types/dto";

export interface AgentPersonaRecord {
  id: string;
  ageBand: AgeBand;
  tone: string;
  systemPrompt: string;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  birthDate: string;
  agentPersonaId: string | null;
  createdAt: string;
}

export interface CareLinkRecord {
  id: string;
  requesterUserId: string;
  targetUserId: string;
  status: CareLinkStatus;
  consentConfirmedAt: string | null;
  createdAt: string;
}

export interface HealthLogRecord {
  id: string;
  userId: string;
  loggedByUserId: string;
  logType: HealthLogType;
  value: string;
  unit: string | null;
  loggedAt: string;
  note: string | null;
  createdAt: string;
}

export interface ConversationRecord {
  id: string;
  userId: string;
  agentPersonaId: string;
  startedAt: string;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}
