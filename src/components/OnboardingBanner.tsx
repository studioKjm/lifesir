// T-014 (seed-v2, AC-004) — AgentPersona 미매칭 사용자를 위한 소프트 유도 배너.
// 강제 리다이렉트가 아니다 — seed-v2 must 제약("생년월일 입력 전에도 앱을
// 정상 사용할 수 있어야 한다")대로, 안 눌러도 페이지 사용에는 지장이 없다.
import Link from "next/link";
import styles from "./OnboardingBanner.module.css";

export function OnboardingBanner() {
  return (
    <div className={styles.banner}>
      <p className={styles.text}>생년월일을 입력하면 AI 코치가 연령대에 맞춰 답해드려요.</p>
      <Link href="/onboarding" className={styles.link}>
        입력하기
      </Link>
    </div>
  );
}
