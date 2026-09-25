"use client";

// T-013 (seed-v3, AC-002) — 월간/연간 플랜 선택 UI. requestBillingAuth()는 DB
// 조회나 비즈니스 로직이 아니라 브라우저를 토스 카드 등록 화면으로 보내는
// 것뿐이라(GoogleSignInButton과 동일한 근거, seed-v2) toss-browser를 여기서
// 직접 호출한다.
import { useState } from "react";
import { requestBillingAuth } from "@/lib/toss-browser";
import styles from "./PlanSelector.module.css";

const PLANS = [
  { value: "monthly", label: "월간", price: "9,900원", period: "/ 월" },
  { value: "yearly", label: "연간", price: "99,000원", period: "/ 년 (2개월치 할인)" },
] as const;

export interface PlanSelectorProps {
  userId: string;
  email: string;
  name: string;
}

export function PlanSelector({ userId, email, name }: PlanSelectorProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSelect(plan: (typeof PLANS)[number]["value"]) {
    setPending(plan);
    setError(null);
    try {
      const origin = window.location.origin;
      await requestBillingAuth({
        customerKey: userId,
        successUrl: `${origin}/subscription/callback?plan=${plan}`,
        failUrl: `${origin}/subscription?error=BILLING_AUTH_FAILED`,
        customerEmail: email,
        customerName: name,
      });
      // 성공 시 브라우저가 토스 카드 등록 화면으로 이동하므로 여기서 할 일이 없다.
    } catch {
      setError("카드 등록을 시작할 수 없어요. 잠시 후 다시 시도해주세요.");
      setPending(null);
    }
  }

  return (
    <div className={styles.grid}>
      {PLANS.map((plan) => (
        <div key={plan.value} className={styles.card}>
          <p className={styles.label}>{plan.label}</p>
          <p className={styles.price}>
            {plan.price} <span className={styles.period}>{plan.period}</span>
          </p>
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => handleSelect(plan.value)}
            disabled={pending !== null}
          >
            {pending === plan.value ? "이동 중..." : "7일 무료체험 시작"}
          </button>
        </div>
      ))}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
