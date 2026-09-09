// T-018 — 세션 게이트 (AC-001)
// Pair Mode(Navigator Plan A)로 설계됨.
// Next.js 16부터 "middleware" 파일 컨벤션이 "proxy"로 이름이 바뀌었다
// (node_modules/next/dist/docs/.../proxy.md 참고, 함수명도 proxy로 변경됨).
//
// 이 프록시는 UX 레벨 게이트일 뿐이다 — 쿠키 존재 여부만 확인하고 토큰의
// 진위/만료는 검증하지 않는다. 진짜 보안 경계(신뢰 가능한 userId 도출)는
// 각 Server Action이 이 쿠키의 access token으로 supabase.auth.getUser(token)을
// 호출하는 지점에서 성립한다 (T-019에서 구현 예정). 신규 의존성(@supabase/ssr)
// 없이 진행하기로 결정함 — CLAUDE.md Absolute Rule #4(신규 의존성 사전 승인).
import { NextResponse, type NextRequest } from "next/server.js";

export const AUTH_COOKIE_NAME = "lifesir_access_token";

export function proxy(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/care-links/:path*", "/chat/:path*"],
};
