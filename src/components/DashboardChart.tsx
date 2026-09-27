// T-023 — 대시보드 집계 시각화 (AC-006, AC-007). 기록 종류마다 카드 한 장에
// 가장 최근 값과 7일 추이 스파크라인을 보여준다("토스 모던", 2026-09-26).
// 본인/부모 대시보드 양쪽에서 재사용한다.
import type { DashboardSummaryDTO, HealthLogType } from "@/types/dto";
import { Sparkline } from "./Sparkline";
import styles from "./DashboardChart.module.css";

const LABELS: Record<HealthLogType, string> = {
  exercise: "운동",
  sleep: "수면",
  weight: "체중",
  meal: "식사",
  medication: "복약",
};

// "토스 스타일" 시안의 아이콘 뱃지(색이 있는 원형 배지 + 라인 아이콘)를 그대로
// 이어간다 — 색상은 카테고리별로 하나씩 배정해 한눈에 구분되게 한다.
const TONES: Record<HealthLogType, "blue" | "green" | "amber" | "red" | "violet"> = {
  exercise: "green",
  sleep: "violet",
  weight: "amber",
  meal: "blue",
  medication: "red",
};

function LogTypeIcon({ type }: { type: HealthLogType }) {
  switch (type) {
    case "exercise":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6.5 6.5 3 10l4 4M17.5 17.5 21 14l-4-4M9 15l6-6M5 9l1.5-1.5M17.5 6.5 19 5M6.5 17.5 5 19M19 19l-1.5-1.5" />
        </svg>
      );
    case "sleep":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 14.5A8 8 0 1 1 10.5 5a6.2 6.2 0 0 0 9.5 9.5Z" />
        </svg>
      );
    case "weight":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="13" r="7" />
          <path d="M12 13 15 10M9 4h6" />
        </svg>
      );
    case "meal":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4v6a2 2 0 0 0 2 2v8M4 4a2 2 0 0 1 2 2M7 4v8M20 4v16M20 4a3 3 0 0 0-3 3v3a3 3 0 0 0 3 3" />
        </svg>
      );
    case "medication":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3.5" y="9.5" width="17" height="7" rx="3.5" transform="rotate(-45 12 13)" />
          <path d="M9 9 15 15" />
        </svg>
      );
  }
}

export interface DashboardChartProps {
  summaryByType: DashboardSummaryDTO[];
}

// 서버/클라이언트(부모 대시보드 polling) 양쪽에서 같은 문자열이 나오도록 시간대를 고정한다.
function formatLatestDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric", timeZone: "Asia/Seoul" });
}

export function DashboardChart({ summaryByType }: DashboardChartProps) {
  return (
    <div className={styles.grid}>
      {summaryByType.map((summary) => (
        <section key={summary.logType} className={styles.tile} aria-label={LABELS[summary.logType]}>
          <div className={styles.head}>
            <span className={`${styles.icon} ${styles[`icon--${TONES[summary.logType]}`]}`} aria-hidden="true">
              <LogTypeIcon type={summary.logType} />
            </span>
            <p className={styles.label}>{LABELS[summary.logType]}</p>
            {summary.loggedToday && <span className="badge badge--ok">오늘</span>}
          </div>
          {summary.latest ? (
            <p className={styles.value}>
              {summary.latest.value}
              {summary.latest.unit && <small>{summary.latest.unit}</small>}
            </p>
          ) : (
            <p className={`${styles.value} ${styles.valueEmpty}`}>—</p>
          )}
          <p className={styles.latest}>
            {summary.latest
              ? summary.loggedToday
                ? `누적 ${summary.count}건`
                : `마지막 기록 ${formatLatestDate(summary.latest.loggedAt)}`
              : "기록 전"}
          </p>
          <div className={styles.spark}>
            <Sparkline values={summary.trend.map((p) => p.value)} label={LABELS[summary.logType]} />
          </div>
        </section>
      ))}
    </div>
  );
}
