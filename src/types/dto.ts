// Presentation ↔ Logic DTO 정의 (TRD 2.1 참고)
// Logic ↔ Data 경계는 repository 반환 타입을 그대로 재사용한다 (seed-v1 tech_decisions).

export type AgeBand = "10s" | "20s" | "30s" | "40s" | "50s_plus";
export type CareLinkStatus = "pending" | "accepted" | "rejected" | "revoked";
export type HealthLogType = "exercise" | "sleep" | "weight" | "meal" | "medication";
export type MessageRole = "user" | "assistant" | "system";
// seed-v3 — 결제/구독
export type SubscriptionPlan = "monthly" | "yearly";
export type SubscriptionStatus = "trial" | "active" | "canceled" | "past_due" | "expired";
export type PaymentAttemptResult = "success" | "failure";

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

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface AuthResult {
  user: { id: string; email: string; name: string };
  session: AuthSession;
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

// T-020 — care-links 페이지 목록 표시용 (AC-003, AC-004).
// direction: 내가 요청자면 "sent"(수락 시 내가 상대 대시보드를 볼 수 있음), 내가 대상자면 "received".
export interface CareLinkListItemDTO extends CareLinkDTO {
  direction: "sent" | "received";
  counterpart?: { id: string; name: string; email: string };
}

export interface ChatMessageInput {
  conversationId?: string; // 미지정 시 새 대화 시작
  content: string;
}

// seed-v2 — @supabase/ssr 쿠키 어댑터. Presentation(Server Action/Route
// Handler/proxy.ts)이 next/headers의 cookies()나 request/response로 실제
// 구현체를 만들어 Logic→Data로 넘긴다. Data 레이어(src/lib/data)는 next/*를
// import할 수 없으므로(boundaries.yaml), 이 얕은 계약을 통해서만 쿠키를 다룬다.
export interface SupabaseCookieAdapter {
  getAll(): { name: string; value: string }[];
  setAll(cookies: { name: string; value: string; options?: Record<string, unknown> }[]): void;
}

export interface MessageDTO {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

// seed-v4 — 관리자의 유일한 쓰기 액션. 새 값이 늘면 DB check 제약도 함께 갱신한다.
export type AdminActionType = "recover_partial_failure";
