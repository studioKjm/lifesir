// T-015 (seed-v3, AC-002) — 토스페이먼츠 카드 등록(빌링키 발급) 콜백. 얇은
// 어댑터로만 두고(TRD §16.1 결정), 실제 로직은 subscription-service.startFreeTrial
// (Logic)에 있다 — src/app/auth/callback/route.ts(seed-v2)와 동일한 패턴.
import { NextResponse, type NextRequest } from "next/server.js";
import * as subscriptionService from "@/services/subscription-service";
import { getSession } from "@/app/_lib/session";
import type { SubscriptionPlan } from "@/types/dto";

// NEXT-007 컨벤션 — Route Handler 리다이렉트는 request.url이 아니라 실제 요청
// Host 헤더 기반으로 origin을 만든다 (src/app/auth/callback/route.ts와 동일한
// 이유, 2026-09-14 발견된 Next.js dev 서버 버그).
function resolveRequestOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return request.nextUrl.origin;
  const protocol = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

const VALID_PLANS: SubscriptionPlan[] = ["monthly", "yearly"];

export async function GET(request: NextRequest) {
  const origin = resolveRequestOrigin(request);

  // proxy.ts matcher가 /subscription/:path*를 보호하지만, Route Handler
  // 자체에서도 세션을 신뢰의 원천으로 다시 확인한다 — 쿼리로 돌아온
  // customerKey는 클라이언트가 왕복시킨 값이라 권한 판단에 쓰지 않는다
  // (Navigator 리뷰: 금전이 걸린 액션에서 클라이언트가 되돌려준 식별자를 그대로
  // 신뢰하지 않는다는 원칙).
  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  const authKey = request.nextUrl.searchParams.get("authKey");
  const planParam = request.nextUrl.searchParams.get("plan");
  const plan = VALID_PLANS.includes(planParam as SubscriptionPlan) ? (planParam as SubscriptionPlan) : null;

  if (!authKey || !plan) {
    return NextResponse.redirect(new URL("/subscription?error=BILLING_AUTH_FAILED", origin));
  }

  try {
    await subscriptionService.startFreeTrial(session.id, plan, authKey);
  } catch (err) {
    if (err instanceof subscriptionService.SubscriptionError) {
      return NextResponse.redirect(new URL(`/subscription?error=${err.code}`, origin));
    }
    throw err;
  }

  return NextResponse.redirect(new URL("/chat", origin));
}
