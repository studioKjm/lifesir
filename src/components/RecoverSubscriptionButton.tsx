"use client";

// T-028 (seed-v4, AC-006) — 구독 복구 폼의 제출 버튼. ResubscribeButton.tsx와
// 동일한 이유로 useFormStatus를 쓰는 별도 client component로 분리한다(감싸는
// <form>의 하위 컴포넌트에서만 pending 상태를 읽을 수 있음) — 같은 탭에서의
// 실수 더블클릭을 막는다(서버 측엔 이 액션 전용 락을 걸지 않음, admin-service.
// recoverStuckSubscription의 docstring 참고 — 실제 결제 API 미호출이라 금전
// 위험이 없고 관리자는 1명뿐이라 이 정도로 충분).
import { useFormStatus } from "react-dom";

export function RecoverSubscriptionButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn--ghost btn--sm" disabled={pending}>
      {pending ? "처리 중..." : "복구"}
    </button>
  );
}
