// T-012 (seed-v2, AC-001, AC-003, AC-007) — 구글 OAuth 콜백. 얇은 어댑터로만
// 두고(TRD 4장 결정), 실제 로직은 auth-service.exchangeGoogleSession(Logic)에 있다.
import { NextResponse, type NextRequest } from "next/server.js";
import * as authService from "@/services/auth-service";
import { buildCookieAdapter } from "@/app/_lib/session";

// 2026-09-14 실사용 검증 중 발견한 버그의 수정: 이 Route Handler에서
// `new URL(path, request.url)`을 쓰면, Next.js 16 dev 서버(Turbopack)가
// request.url의 origin을 실제 요청 Host(예: 127.0.0.1:3100)와 무관하게
// "localhost:<port>"로 고정해버린다(curl로 Host 헤더를 바꿔도 Location이
// 항상 localhost로 나오는 것으로 확인). 세션 쿠키는 실제 요청 host(127.0.0.1)
// 에 심기는데 그 다음 리다이렉트가 다른 host(localhost)로 가버리면 브라우저가
// 쿠키를 안 보내 세션이 끊긴다 — /dashboard까지 302는 뜨지만 proxy.ts가 세션을
// 못 찾아 다시 /login으로 튕긴다(AC-001/003이 화면상 "로그인 실패"처럼 보이는
// 원인). 실제 요청의 Host 헤더에서 origin을 직접 만들어 이 문제를 피한다.
function resolveRequestOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return request.nextUrl.origin;
  const protocol = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const origin = resolveRequestOrigin(request);

  // 사용자가 구글 동의화면에서 취소했거나 code 파라미터 없이 들어온 경우 (AC-007).
  if (!code) {
    return NextResponse.redirect(new URL("/login?error=OAUTH_CANCELLED", origin));
  }

  try {
    await authService.exchangeGoogleSession(code, await buildCookieAdapter());
  } catch (err) {
    if (err instanceof authService.AuthError) {
      return NextResponse.redirect(new URL(`/login?error=${err.code}`, origin));
    }
    throw err;
  }

  return NextResponse.redirect(new URL("/dashboard", origin));
}
