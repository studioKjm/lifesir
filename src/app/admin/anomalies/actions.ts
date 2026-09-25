"use server";

// T-028 (seed-v4, AC-006, AC-008) — 구독 복구 Server Action. 얇은 어댑터로만
// 두고 실제 로직(서버 재검증, 상태 갱신, 감사 로그)은 admin-service(Logic)에
// 있다. 페이지의 isAdminEmail 체크와 별개로 이 함수 자신도 세션을 다시 읽어
// 재확인한다(defense-in-depth) — UI를 거치지 않고 이 액션을 직접 호출해도
// 막혀야 한다(AC-008/AC-006 "직접 API 호출 포함 차단" 요구).
//
// ⚠️ 알려진 잔여 갭(Navigator 리뷰, 2026-09-19): "비관리자 세션으로 이 Server
// Action을 직접(페이지 우회) 호출해도 거부되는지"는 e2e로 검증되지 않았다 —
// Next.js Server Action은 `/api/chat` 같은 고정 공개 Route Handler와 달리
// 빌드 시 해시된 action reference라, 세션을 바꿔가며 직접 재현하는 e2e가 이
// 코드베이스에 선례가 없고 시도할 경우 취약(flaky)해질 위험이 크다. 코드
// 레벨 방어(위 isAdminEmail 재확인)는 페이지 게이트와 동일한, 이 seed 전체에서
// 반복 검증된 패턴이라 위험도는 낮게 평가한다. seed-v3의
// cancelSubscriptionAction/resubscribeAction도 동일한 잔여 갭을 가지고
// 있다(이번에 새로 생긴 문제가 아니라 이 코드베이스 Server Action 전반의
// 기존 특성) — "몰라서 안 한 것"과 "알고도 의도적으로 남긴 것"을 구분해
// 여기 명시적으로 기록해둔다.
import { redirect } from "next/navigation";
import { getSession } from "@/app/_lib/session";
import { isAdminEmail, recoverStuckSubscription, AdminError } from "@/services/admin-service";

export async function recoverStuckSubscriptionAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isAdminEmail(session.email)) redirect("/dashboard");

  const subscriptionId = String(formData.get("subscriptionId") ?? "");
  if (!subscriptionId) redirect("/admin/anomalies?error=INVALID_INPUT");

  let outcome: Awaited<ReturnType<typeof recoverStuckSubscription>>["outcome"];
  try {
    ({ outcome } = await recoverStuckSubscription(session.id, subscriptionId));
  } catch (err) {
    if (err instanceof AdminError) {
      redirect(`/admin/anomalies?error=${err.code}`);
    }
    throw err;
  }

  redirect(`/admin/anomalies?notice=${outcome}`);
}
