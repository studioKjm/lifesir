import { notFound, redirect } from "next/navigation";
import { getSession } from "@/app/_lib/session";
import * as careLinkService from "@/services/care-link-service";
import * as dashboardService from "@/services/dashboard-service";
import { CareLinkError } from "@/services/care-link-service";
import { isAdminEmail } from "@/services/admin-service";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { ParentDashboardLive } from "@/components/ParentDashboardLive";
import { HealthLogForm } from "@/components/HealthLogForm";
import styles from "./parent-dashboard.module.css";

export const metadata = { title: "가족 대시보드 — 동행" };

const ERROR_COPY: Record<string, string> = {
  INVALID_INPUT: "종류, 값, 기록 시각은 필수예요.",
  NOT_AUTHORIZED: "연결이 해제되어 대신 기록할 권한이 없어요.",
};

export default async function ParentDashboardPage({
  params,
  searchParams,
}: PageProps<"/dashboard/[careLinkId]">) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { careLinkId } = await params;
  const { error } = await searchParams;
  const errorCode = Array.isArray(error) ? error[0] : error;

  const link = await careLinkService.getCareLinkById(careLinkId);
  if (!link) notFound();

  const links = await careLinkService.listCareLinks(session.id);
  const counterpartName = links.find((l) => l.id === careLinkId)?.counterpart?.name ?? "가족";

  let view;
  try {
    view = await dashboardService.getParentDashboard(session.id, link.targetUserId);
  } catch (err) {
    if (err instanceof CareLinkError) {
      return (
        <AppShell active="care-links" user={session} isAdmin={isAdminEmail(session.email)}>
          <EmptyState variant="forbidden" />
        </AppShell>
      );
    }
    throw err;
  }

  return (
    <AppShell active="care-links" user={session} isAdmin={isAdminEmail(session.email)}>
      <h1 className="page-title">{counterpartName}님의 건강 대시보드</h1>
      <p className="page-subtitle">기록 열람은 읽기 전용이에요. 대신 기록은 아래에서 남길 수 있어요.</p>

      {errorCode && (
        <div role="alert">
          <p>{ERROR_COPY[errorCode] ?? "알 수 없는 오류가 발생했어요."}</p>
        </div>
      )}

      <div className={`card ${styles.liveCard}`}>
        <ParentDashboardLive careLinkId={careLinkId} initialView={view} />
      </div>

      <div className="card">
        <h2 className="section-title">{counterpartName}님 대신 기록하기</h2>
        <p className={styles.formHint}>연결이 수락된 동안에만 대신 기록할 수 있어요.</p>
        <HealthLogForm targetUserId={link.targetUserId} careLinkId={careLinkId} />
      </div>
    </AppShell>
  );
}
