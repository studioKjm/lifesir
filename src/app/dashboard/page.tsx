import { redirect } from "next/navigation";
import { getSession } from "@/app/_lib/session";
import * as dashboardService from "@/services/dashboard-service";
import { isAdminEmail } from "@/services/admin-service";
import { AppShell } from "@/components/AppShell";
import { DashboardChart } from "@/components/DashboardChart";
import { HealthLogForm } from "@/components/HealthLogForm";
import { EmptyState } from "@/components/EmptyState";
import { OnboardingBanner } from "@/components/OnboardingBanner";
import Link from "next/link";
import type { HealthLogType } from "@/types/dto";
import styles from "./dashboard.module.css";

const LABELS: Record<HealthLogType, string> = {
  exercise: "운동",
  sleep: "수면",
  weight: "체중",
  meal: "식사",
  medication: "복약",
};

const ERROR_COPY: Record<string, string> = {
  INVALID_INPUT: "종류, 값, 기록 시각은 필수예요.",
  NOT_AUTHORIZED: "이 사용자의 건강 기록을 대신 입력할 권한이 없어요.",
};

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { error } = await searchParams;
  const errorCode = Array.isArray(error) ? error[0] : error;

  const view = await dashboardService.getOwnDashboard(session.id);

  const loggedTodayCount = view.summaryByType.filter((s) => s.loggedToday).length;
  const today = new Date().toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "Asia/Seoul",
  });

  return (
    <AppShell active="dashboard" user={session} isAdmin={isAdminEmail(session.email)}>
      <header className={styles.top}>
        <div>
          <p className={styles.date}>{today}</p>
          <h1 className={styles.title}>
            {loggedTodayCount === 0 ? (
              <>{session.name}님, 오늘 첫 기록을 남겨볼까요?</>
            ) : (
              <>
                {session.name}님, 오늘 기록 {view.summaryByType.length}개 중{" "}
                <em>{loggedTodayCount}개</em>를 채웠어요
              </>
            )}
          </h1>
        </div>
        <a href="#log-form" className="btn btn--primary">
          기록 추가
        </a>
      </header>

      {!session.agentPersonaId && <OnboardingBanner />}

      {errorCode && (
        <div role="alert">
          <p>{ERROR_COPY[errorCode] ?? "알 수 없는 오류가 발생했어요."}</p>
        </div>
      )}

      <DashboardChart summaryByType={view.summaryByType} />

      <div className={styles.layout}>
        <div className="card">
          <h2 className="section-title">최근 기록</h2>
          {view.entries.length === 0 ? (
            <EmptyState variant="empty" />
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>시각</th>
                    <th>종류</th>
                    <th>값</th>
                    <th>메모</th>
                  </tr>
                </thead>
                <tbody>
                  {view.entries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{new Date(entry.loggedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</td>
                      <td>{LABELS[entry.logType]}</td>
                      <td className="data-table__value">
                        {entry.value}
                        {entry.unit ?? ""}
                      </td>
                      <td className="data-table__note">{entry.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className={styles.side}>
          <div className={`card ${styles.logForm}`} id="log-form">
            <h2 className="section-title">기록 추가</h2>
            <HealthLogForm />
          </div>
          <Link href="/chat" className={styles.coach}>
            <span className={styles.coachLabel}>AI 코치</span>
            <span className={styles.coachText}>오늘 컨디션이나 기록이 궁금하면 연령대에 맞춘 코치에게 물어보세요.</span>
            <span className={styles.coachCta}>대화하기 →</span>
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
