// T-023 — 대시보드 집계 시각화 (AC-006, AC-007). log_type별 기록 수를 막대로
// 비교하고 가장 최근 기록을 함께 보여준다. 본인/부모 대시보드 양쪽에서 재사용한다.
import type { DashboardSummaryDTO, HealthLogType } from "@/types/dto";
import styles from "./DashboardChart.module.css";

const LABELS: Record<HealthLogType, string> = {
  exercise: "운동",
  sleep: "수면",
  weight: "체중",
  meal: "식사",
  medication: "복약",
};

export interface DashboardChartProps {
  summaryByType: DashboardSummaryDTO[];
}

export function DashboardChart({ summaryByType }: DashboardChartProps) {
  const maxCount = Math.max(1, ...summaryByType.map((s) => s.count));

  return (
    <div className={styles.grid}>
      {summaryByType.map((summary) => (
        <div key={summary.logType} className={styles.tile}>
          <p className={styles.label}>{LABELS[summary.logType]}</p>
          <p className={styles.count}>
            {summary.count}
            <small>건</small>
          </p>
          <div className={styles.bar}>
            <div className={styles.barFill} style={{ width: `${(summary.count / maxCount) * 100}%` }} />
          </div>
          <p className={styles.latest}>
            {summary.latest ? `최근 ${summary.latest.value}${summary.latest.unit ?? ""}` : "기록 없음"}
          </p>
        </div>
      ))}
    </div>
  );
}
