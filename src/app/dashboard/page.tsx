import { redirect } from "next/navigation";
import { getSession } from "@/app/_lib/session";
import * as dashboardService from "@/services/dashboard-service";
import { AppShell } from "@/components/AppShell";
import { DashboardChart } from "@/components/DashboardChart";
import { HealthLogForm } from "@/components/HealthLogForm";
import { EmptyState } from "@/components/EmptyState";
import { OnboardingBanner } from "@/components/OnboardingBanner";
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

  return (
    <AppShell active="dashboard" user={session}>
      <h1 className="page-title">내 건강 대시보드</h1>
      <p className="page-subtitle">오늘 하루의 기록을 남기고 흐름을 확인하세요.</p>

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
          )}
        </div>

        <div className={`card ${styles.formCard}`}>
          <h2 className="section-title">기록 추가</h2>
          <HealthLogForm />
        </div>
      </div>
    </AppShell>
  );
}
