// T-021 — HealthLog 입력 폼 (AC-005). 본인 기록이 기본. targetUserId를 넘기면
// 대리입력 모드로 동작한다(권한 가드는 Logic 레이어 health-log-service가 담당).
import { recordHealthLogAction } from "@/app/dashboard/actions";
import styles from "./HealthLogForm.module.css";

const LOG_TYPE_OPTIONS: { value: string; label: string; unit: string }[] = [
  { value: "exercise", label: "운동", unit: "분" },
  { value: "sleep", label: "수면", unit: "시간" },
  { value: "weight", label: "체중", unit: "kg" },
  { value: "meal", label: "식사", unit: "" },
  { value: "medication", label: "복약", unit: "" },
];

function nowForDatetimeLocal(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

export interface HealthLogFormProps {
  /** 지정 시 대리입력(부모 등의 기록을 자녀가 입력) — health-log-service가 CareLink accepted 여부를 검증한다. */
  targetUserId?: string;
  /** 대리입력일 때 제출 후 돌아갈 부모 대시보드 CareLink id (미지정 시 본인 대시보드로 이동). */
  careLinkId?: string;
}

export function HealthLogForm({ targetUserId, careLinkId }: HealthLogFormProps) {
  return (
    <form action={recordHealthLogAction} className={styles.grid}>
      {targetUserId && <input type="hidden" name="targetUserId" value={targetUserId} />}
      {careLinkId && <input type="hidden" name="careLinkId" value={careLinkId} />}
      <div className="field">
        <label htmlFor="logType">종류</label>
        <select id="logType" name="logType" required defaultValue="exercise">
          {LOG_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="loggedAt">기록 시각</label>
        <input id="loggedAt" name="loggedAt" type="datetime-local" defaultValue={nowForDatetimeLocal()} required />
      </div>
      <div className="field">
        <label htmlFor="value">값</label>
        <input id="value" name="value" type="text" placeholder="예: 30, 7.5, 소고기 미역국" required />
      </div>
      <div className="field">
        <label htmlFor="unit">단위 (선택)</label>
        <input id="unit" name="unit" type="text" placeholder="예: 분, kg" />
      </div>
      <div className={`field ${styles.full}`}>
        <label htmlFor="note">메모 (선택)</label>
        <textarea id="note" name="note" placeholder="컨디션이나 특이사항을 남겨보세요" />
      </div>
      <button type="submit" className={`btn btn--primary ${styles.full}`}>
        기록하기
      </button>
    </form>
  );
}
