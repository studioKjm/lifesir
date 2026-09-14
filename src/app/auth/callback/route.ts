// T-012 (seed-v2, AC-001, AC-003, AC-007) — 구글 OAuth 콜백. 얇은 어댑터로만
// 두고(TRD 4장 결정), 실제 로직은 auth-service.exchangeGoogleSession(Logic)에 있다.
import { NextResponse, type NextRequest } from "next/server.js";
import * as authService from "@/services/auth-service";
import { buildCookieAdapter } from "@/app/_lib/session";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  // 사용자가 구글 동의화면에서 취소했거나 code 파라미터 없이 들어온 경우 (AC-007).
  if (!code) {
    return NextResponse.redirect(new URL("/login?error=OAUTH_CANCELLED", request.url));
  }

  try {
    await authService.exchangeGoogleSession(code, await buildCookieAdapter());
  } catch (err) {
    if (err instanceof authService.AuthError) {
      return NextResponse.redirect(new URL(`/login?error=${err.code}`, request.url));
    }
    throw err;
  }

  return NextResponse.redirect(new URL("/dashboard", request.url));
}
