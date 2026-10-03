// T-024 (seed-v4, AC-001, AC-004, AC-008) — 어드민 대시보드 요약 페이지.
// 매출/구독자 상태 분포(AC-001) + 서비스 전체 집계(AC-004)를 한 화면에
// 렌더링한다. isAdminEmail 재확인은 이 파일이 proxy.ts와 별개로 직접
// 수행한다(defense-in-depth, admin-service.isAdminEmail의 docstring 규약).
import { redirect } from "next/navigation";
import { getSession } from "@/app/_lib/session";
import { isAdminEmail, getRevenueSummary, getServiceStats } from "@/services/admin-service";
import { AppShell } from "@/components/AppShell";
import type { SubscriptionStatus } from "@/types/dto";
import styles from "../admin.module.css";

export const metadata = { title: "관리자 대시보드 — 동행" };

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  trial: "무료체험",
  active: "이용중",
  past_due: "결제실패",
  canceled: "해지(유예)",
  expired: "만료",
};
const STATUS_ORDER: SubscriptionStatus[] = ["trial", "active", "past_due", "canceled", "expired"];

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

/** "YYYY-MM" → 그 달의 [시작, 다음달 시작) 배타적 범위(UTC). */
function monthToRange(month: string): { start: string; end: string } {
  const [year, monthNum] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNum - 1, 1));
  const end = new Date(Date.UTC(year, monthNum, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatKRW(amount: number): string {
  return `${amount.toLocaleString("ko-KR")}원`;
}

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isAdminEmail(session.email)) redirect("/dashboard");

  const { month: rawMonth } = await searchParams;
  const monthParam = Array.isArray(rawMonth) ? rawMonth[0] : rawMonth;
  const month = monthParam && MONTH_PATTERN.test(monthParam) ? monthParam : currentMonth();

  const [revenue, stats] = await Promise.all([getRevenueSummary(monthToRange(month)), getServiceStats()]);

  return (
    <AppShell active="admin" user={session} isAdmin>
      <h1 className="page-title">관리자 대시보드</h1>
      <p className="page-subtitle">매출/구독 현황과 서비스 전체 지표를 확인하세요.</p>

      <section className={styles.statGrid}>
        <div className="card">
          <span className={styles.statLabel}>가입자 수</span>
          <span className={styles.statValue}>{stats.userCount.toLocaleString("ko-KR")}명</span>
        </div>
        <div className="card">
          <span className={styles.statLabel}>총 건강 기록 수</span>
          <span className={styles.statValue}>{stats.healthLogCount.toLocaleString("ko-KR")}건</span>
        </div>
        <div className="card">
          <span className={styles.statLabel}>활성 케어링크 수</span>
          <span className={styles.statValue}>{stats.activeCareLinkCount.toLocaleString("ko-KR")}건</span>
        </div>
      </section>

      <section className={`card ${styles.revenueCard}`}>
        <form className={styles.monthForm}>
          <label htmlFor="month">조회 월</label>
          <input id="month" type="month" name="month" defaultValue={month} />
          <button type="submit" className="btn btn--ghost btn--sm">
            조회
          </button>
        </form>
        <span className={styles.statLabel}>{month} 매출 합계</span>
        <span className={styles.statValue}>{formatKRW(revenue.revenueTotal)}</span>
      </section>

      <section className="card">
        <h2 className={styles.sectionTitle}>구독 상태별 분포</h2>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>상태</th>
                <th>구독자 수</th>
              </tr>
            </thead>
            <tbody>
              {STATUS_ORDER.map((status) => (
                <tr key={status}>
                  <td>{STATUS_LABEL[status]}</td>
                  <td className="data-table__value">{revenue.statusCounts[status].toLocaleString("ko-KR")}명</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
