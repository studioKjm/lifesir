// T-026 (seed-v4, AC-003, AC-008) — 구독자 상세(구독 이력 + 결제 시도 이력).
// PaymentMethod/billing_key는 이 화면에서 조회·렌더하지 않는다(Navigator Plan A).
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/app/_lib/session";
import { isAdminEmail, getSubscriberDetail } from "@/services/admin-service";
import { AppShell } from "@/components/AppShell";
import type { SubscriptionStatus, PaymentAttemptResult } from "@/types/dto";
import styles from "../../admin.module.css";

export const metadata = { title: "구독자 상세 — 관리자 — 동행" };

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  trial: "무료체험",
  active: "이용중",
  past_due: "결제실패",
  canceled: "해지(유예)",
  expired: "만료",
};
const RESULT_LABEL: Record<PaymentAttemptResult, string> = { success: "성공", failure: "실패" };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

export default async function AdminSubscriberDetailPage({ params }: PageProps<"/admin/subscribers/[userId]">) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isAdminEmail(session.email)) redirect("/dashboard");

  const { userId } = await params;
  const detail = await getSubscriberDetail(userId);
  if (!detail) notFound();

  return (
    <AppShell active="admin" user={session} isAdmin>
      <h1 className="page-title">{detail.user.name}</h1>
      <p className="page-subtitle">{detail.user.email}</p>

      {detail.subscriptions.length === 0 ? (
        <p className="page-subtitle">구독 이력이 없어요.</p>
      ) : (
        detail.subscriptions.map((sub) => (
          <section key={sub.id} className={`card ${styles.revenueCard}`}>
            <span className={styles.statLabel}>
              {sub.plan === "monthly" ? "월간" : "연간"} · {STATUS_LABEL[sub.status]}
            </span>
            <span className={styles.statValue}>{sub.amount.toLocaleString("ko-KR")}원</span>
            <p className="page-subtitle">
              {formatDate(sub.currentPeriodStart)} ~ {formatDate(sub.currentPeriodEnd)}
            </p>

            {sub.paymentAttempts.length === 0 ? (
              <p className="page-subtitle">결제 시도 기록이 없어요.</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>시도 시각</th>
                      <th>결과</th>
                      <th>금액</th>
                      <th>실패 사유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sub.paymentAttempts.map((attempt) => (
                      <tr key={attempt.id}>
                        <td>{formatDate(attempt.attemptedAt)}</td>
                        <td className="data-table__value">{RESULT_LABEL[attempt.result]}</td>
                        <td>{attempt.amount.toLocaleString("ko-KR")}원</td>
                        <td className="data-table__note">{attempt.failureReason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))
      )}
    </AppShell>
  );
}
