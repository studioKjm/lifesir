// Data 레이어 레코드 타입 (Logic↔Data 경계에서 그대로 재사용 — seed-v1 tech_decisions).
// DB 컬럼은 snake_case, 레코드는 camelCase로 매핑해 반환한다.
import type {
  AgeBand,
  CareLinkStatus,
  HealthLogType,
  MessageRole,
  SubscriptionPlan,
  SubscriptionStatus,
  PaymentAttemptResult,
  AdminActionType,
} from "@/types/dto";

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
  // seed-v2: 구글 OAuth로 처음 로그인하면 온보딩 전까지 생년월일이 없다.
  birthDate: string | null;
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

// seed-v3 — 결제/구독
export interface PaymentMethodRecord {
  id: string;
  userId: string;
  billingKey: string;
  cardLast4: string;
  registeredAt: string;
}

export interface SubscriptionRecord {
  id: string;
  userId: string;
  plan: SubscriptionPlan;
  amount: number;
  status: SubscriptionStatus;
  trialEndAt: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  nextBillingAt: string | null;
  canceledAt: string | null;
  createdAt: string;
}

export interface PaymentAttemptRecord {
  id: string;
  subscriptionId: string;
  attemptedAt: string;
  result: PaymentAttemptResult;
  amount: number;
  pgTransactionId: string | null;
  failureReason: string | null;
}

export interface AdminActionLogRecord {
  id: string;
  adminUserId: string;
  subscriptionId: string;
  actionType: AdminActionType;
  previousStatus: SubscriptionStatus;
  newStatus: SubscriptionStatus;
  performedAt: string;
}
