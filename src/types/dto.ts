// Presentation ↔ Logic DTO 정의 (TRD 2.1 참고)
// Logic ↔ Data 경계는 repository 반환 타입을 그대로 재사용한다 (seed-v1 tech_decisions).

export type AgeBand = "10s" | "20s" | "30s" | "40s" | "50s_plus";
export type CareLinkStatus = "pending" | "accepted" | "rejected" | "revoked";
export type HealthLogType = "exercise" | "sleep" | "weight" | "meal" | "medication";
export type MessageRole = "user" | "assistant" | "system";

export interface SignUpInput {
  email: string;
  password: string;
  name: string;
  birthDate: string; // YYYY-MM-DD
}

export interface SignInInput {
  email: string;
  password: string;
}

export interface HealthLogInput {
  targetUserId?: string; // 미지정 시 본인 기록
  logType: HealthLogType;
  value: string;
  unit?: string;
  loggedAt: string; // ISO timestamp
  note?: string;
}

export interface HealthLogEntryDTO {
  id: string;
  logType: HealthLogType;
  value: string;
  unit?: string;
  loggedAt: string;
  note?: string;
  loggedByUserId: string;
}

export interface DashboardSummaryDTO {
  logType: HealthLogType;
  count: number;
  latest?: HealthLogEntryDTO;
}

export interface DashboardViewDTO {
  entries: HealthLogEntryDTO[];
  summaryByType: DashboardSummaryDTO[];
}

export interface CareLinkRequestInput {
  targetEmail: string;
}

export interface CareLinkDecisionInput {
  careLinkId: string;
  decision: "accept" | "reject";
}

export interface CareLinkDTO {
  id: string;
  requesterUserId: string;
  targetUserId: string;
  status: CareLinkStatus;
  createdAt: string;
}

export interface ChatMessageInput {
  conversationId?: string; // 미지정 시 새 대화 시작
  content: string;
}

export interface MessageDTO {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}
