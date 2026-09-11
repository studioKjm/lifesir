"use client";

// T-024 — 부모 대시보드, 읽기전용, 15초 polling (AC-007). 초기 데이터는 서버에서
// 렌더링되고, 이후 /api/dashboard/[careLinkId]를 주기적으로 호출해 갱신한다.
import { useEffect, useState } from "react";
import { DashboardChart } from "@/components/DashboardChart";
import { EmptyState } from "@/components/EmptyState";
import type { DashboardViewDTO, HealthLogType } from "@/types/dto";
import styles from "./ParentDashboardLive.module.css";

const LABELS: Record<HealthLogType, string> = {
  exercise: "운동",
  sleep: "수면",
  weight: "체중",
  meal: "식사",
  medication: "복약",
};

const POLL_INTERVAL_MS = 15_000;

export interface ParentDashboardLiveProps {
  careLinkId: string;
  initialView: DashboardViewDTO;
}

export function ParentDashboardLive({ careLinkId, initialView }: ParentDashboardLiveProps) {
  const [view, setView] = useState(initialView);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/dashboard/${careLinkId}`, { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 403) {
          setForbidden(true);
          clearInterval(timer);
          return;
        }
        if (!res.ok) return; // 일시적 오류는 다음 polling에서 재시도
        setView(await res.json());
      } catch {
        // 네트워크 오류는 다음 polling 주기에 자동 재시도된다.
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [careLinkId]);

  if (forbidden) {
    return <EmptyState variant="forbidden" description="연결이 해제되었어요. 상대방에게 다시 요청해주세요." />;
  }

  return (
    <div>
      <span className={styles.liveDot}>
        <span className={styles.dot} aria-hidden="true" />
        15초마다 자동 갱신
      </span>

      <div style={{ marginTop: 14 }}>
        <DashboardChart summaryByType={view.summaryByType} />
      </div>

      {view.entries.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState variant="empty" description="아직 기록이 없어요." />
        </div>
      ) : (
        <table className={styles.table}>
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
                <td className={styles.value}>
                  {entry.value}
                  {entry.unit ?? ""}
                </td>
                <td style={{ color: "var(--ink-muted)", fontSize: 12 }}>{entry.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
