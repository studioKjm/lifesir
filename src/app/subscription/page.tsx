// T-014 (seed-v3, AC-002, AC-006, AC-008, AC-009) — 구독 시작/상태조회/해지/
// 재구독 통합 페이지. getSubscriptionStatus의 reason으로 5-way 분기한다.
//
// AppShell(상단 네비)에 "구독" 링크가 이번 라운드에서 추가됐다(AC-002/006/008
// 라운드마다 "AC-009에서 결정"으로 미뤄뒀던 것) — 그래서 이 페이지도 다른
// 인증 페이지와 동일하게 AppShell로 감싼다(더 이상 login/signup류의 독립
// center-screen 화면이 아니다).
import { redirect } from "next/navigation";
import { getSession } from "@/app/_lib/session";
import * as subscriptionService from "@/services/subscription-service";
import { isAdminEmail } from "@/services/admin-service";
import { AppShell } from "@/components/AppShell";
import { PlanSelector } from "@/components/PlanSelector";
import { ResubscribeButton } from "@/components/ResubscribeButton";
import { cancelSubscriptionAction, resubscribeAction } from "./actions";
import type { SubscriptionPlan } from "@/types/dto";
import styles from "./subscription.module.css";

export const metadata = { title: "구독 관리 — 동행" };

const ERROR_COPY: Record<string, string> = {
  BILLING_AUTH_FAILED: "카드 등록에 실패했어요. 잠시 후 다시 시도해주세요.",
  PAYMENT_METHOD_ALREADY_EXISTS: "이미 결제수단이 등록되어 있어요.",
  BILLING_KEY_ISSUE_FAILED: "카드 등록에 실패했어요. 잠시 후 다시 시도해주세요.",
  SUBSCRIPTION_CREATE_FAILED: "구독 시작에 실패했어요. 잠시 후 다시 시도해주세요.",
  NO_CANCELABLE_SUBSCRIPTION: "해지할 수 있는 구독이 없어요.",
  NO_PAYMENT_METHOD: "등록된 결제수단이 없어요.",
  SUBSCRIPTION_ALREADY_ACTIVE: "이미 이용 중인 구독이 있어요.",
  CHARGE_FAILED: "결제에 실패했어요. 카드 상태를 확인한 뒤 다시 시도해주세요.",
  INVALID_INPUT: "플랜을 선택해주세요.",
};

const RESUBSCRIBE_COPY: Partial<Record<string, string>> = {
  "blocked:past_due": "최근 결제에 실패해 구독이 중지됐어요. 재구독하면 다시 이용할 수 있어요.",
  "blocked:expired": "구독이 만료됐어요. 재구독하면 다시 이용할 수 있어요.",
};

const PLAN_LABEL: Record<SubscriptionPlan, string> = { monthly: "월간", yearly: "연간" };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

export default async function SubscriptionPage({ searchParams }: PageProps<"/subscription">) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { error } = await searchParams;
  const errorCode = Array.isArray(error) ? error[0] : error;

  const status = await subscriptionService.getSubscriptionStatus(session.id);

  return (
    <AppShell active="subscription" user={session} isAdmin={isAdminEmail(session.email)}>
      <h1 className="page-title">구독 관리</h1>
      <p className="page-subtitle">AI 코치는 7일 무료체험 후 구독으로 계속 이용할 수 있어요.</p>

      {errorCode && (
        <div role="alert">
          <p>{ERROR_COPY[errorCode] ?? "알 수 없는 오류가 발생했어요."}</p>
        </div>
      )}

      <div className={`card ${styles.panel}`}>
        {!status.hasSubscription ? (
          <PlanSelector userId={session.id} email={session.email} name={session.name} />
        ) : status.reason === "trial_active" || status.reason === "paid_active" ? (
          <div className={styles.statusCard}>
            <p className={styles.planLine}>
              <span className="badge badge--ok">{status.reason === "trial_active" ? "무료체험 중" : "이용 중"}</span>
              {PLAN_LABEL[status.plan!]} 플랜
            </p>
            {status.nextBillingAt && <p className={styles.dateLine}>다음 결제일: {formatDate(status.nextBillingAt)}</p>}
            <form action={cancelSubscriptionAction}>
              <button type="submit" className="btn btn--ghost">
                구독 해지
              </button>
            </form>
          </div>
        ) : status.reason === "grace_until_period_end" ? (
          // 해지됐지만 유예기간 중 — 재구독 버튼을 보여주지 않는다(남은 기간을
          // 버리고 지금 다시 결제할 이유가 없다, resubscribe의 자격 판정과 동일한 전제).
          <div className={styles.statusCard}>
            <p className={styles.planLine}>
              <span className="badge badge--muted">해지됨</span>
              {PLAN_LABEL[status.plan!]} 플랜
            </p>
            {status.currentPeriodEnd && (
              <p className={styles.dateLine}>이용 가능 기한: {formatDate(status.currentPeriodEnd)}</p>
            )}
          </div>
        ) : (
          <form action={resubscribeAction} className={styles.statusCard}>
            <p className={styles.planLine}>
              <span className="badge badge--wait">{status.reason === "blocked:past_due" ? "결제 실패" : "만료됨"}</span>
              {PLAN_LABEL[status.plan!]} 플랜
            </p>
            {/* past_due는 보여줄 날짜가 없다 — next_billing_at이 이미 null이고
                차단도 특정 날짜 도달이 아니라 즉시 발생했다(Navigator Plan A). */}
            {status.reason === "blocked:expired" && status.currentPeriodEnd && (
              <p className={styles.dateLine}>만료일: {formatDate(status.currentPeriodEnd)}</p>
            )}
            <p style={{ color: "var(--ink-muted)", fontSize: 14 }}>
              {RESUBSCRIBE_COPY[status.reason ?? ""] ?? "재구독하면 AI 코치를 다시 이용할 수 있어요."}
            </p>
            <div className="field">
              <label htmlFor="plan">플랜</label>
              <select id="plan" name="plan" defaultValue="monthly">
                <option value="monthly">월간 9,900원</option>
                <option value="yearly">연간 99,000원</option>
              </select>
            </div>
            <ResubscribeButton />
          </form>
        )}
      </div>
    </AppShell>
  );
}
