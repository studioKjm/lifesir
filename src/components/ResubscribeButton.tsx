"use client";

// T-016 (seed-v3, AC-008) — 재구독 폼의 제출 버튼. useFormStatus는 감싸는
// <form>의 하위 컴포넌트에서만 pending 상태를 읽을 수 있어(Server Component인
// form 자체가 아니라) 별도 client component로 분리해야 한다.
//
// 존재 이유(Navigator 리뷰, RETRY 사유): 재구독은 실제 카드 청구를 트리거한다
// — 더블클릭으로 폼이 두 번 제출되면 이중 청구로 이어질 수 있다. past_due
// 기원 재구독은 Data 레이어의 조건부 UPDATE(markPastDueAsExpired)로 레이스를
// 막지만, canceled+기간종료/expired 기원은 그 방어가 없어(선점할 살아있는
// 레코드가 없음) 여기서 실수로 인한 더블클릭의 절대다수를 막는다. 잔여
// 네트워크 레벨 동시 요청은 알려진 제약으로 남겨둔다.
import { useFormStatus } from "react-dom";

export function ResubscribeButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn--primary" disabled={pending}>
      {pending ? "처리 중..." : "재구독하기"}
    </button>
  );
}
