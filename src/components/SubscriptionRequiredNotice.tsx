// T-017 (seed-v3, AC-001) — AI 코치 접근이 차단됐을 때 /chat에 보여주는 안내.
// OnboardingBanner(소프트 유도)와 달리 이건 실제로 ChatWindow를 대체한다 —
// 구독 없이는 기능 자체를 쓸 수 없다는 게 AC-001의 요구사항이다.
import Link from "next/link";
import type { AICoachAccessReason } from "@/services/subscription-service";
import styles from "./SubscriptionRequiredNotice.module.css";

const COPY: Partial<Record<AICoachAccessReason, string>> = {
  "blocked:no_subscription": "AI 코치는 7일 무료체험 후 구독으로 계속 이용할 수 있어요.",
  "blocked:past_due": "최근 결제에 실패해 AI 코치 이용이 중지됐어요. 재구독하면 다시 이용할 수 있어요.",
  "blocked:expired": "구독이 만료됐어요. 재구독하면 AI 코치를 다시 이용할 수 있어요.",
};

export interface SubscriptionRequiredNoticeProps {
  reason: AICoachAccessReason;
}

export function SubscriptionRequiredNotice({ reason }: SubscriptionRequiredNoticeProps) {
  return (
    <div className={styles.notice} role="status">
      <p className={styles.text}>{COPY[reason] ?? "AI 코치를 이용하려면 구독이 필요해요."}</p>
      <Link href="/subscription" className="btn btn--primary">
        구독하기
      </Link>
    </div>
  );
}
