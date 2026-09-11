// T-019 — 페이지/Server Action 공용 세션 조회 헬퍼.
// src/proxy.ts는 쿠키 존재 여부만 보는 UX 게이트다. 여기서 실제 신뢰 가능한
// userId를 얻는다: 쿠키의 access token을 Logic 레이어(auth-service)에 넘겨
// 검증한다. src/app은 boundaries.yaml 규칙상 Data 레이어를 직접 import할 수
// 없으므로 반드시 이 경로(Presentation → Logic)로만 세션을 조회한다.
import { cookies } from "next/headers";
import { getSessionUser } from "@/services/auth-service";
import { AUTH_COOKIE_NAME } from "@/proxy";
import type { AuthSession } from "@/types/dto";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/** 로그인 상태면 사용자를, 아니면 null을 반환한다. */
export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  return getSessionUser(token);
}

/** signUp/signIn 성공 직후 Server Action에서 호출한다 (AC-001). */
export async function setSessionCookie(session: AuthSession) {
  (await cookies()).set(AUTH_COOKIE_NAME, session.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7일 — 1주 프로토타입 스코프
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(AUTH_COOKIE_NAME);
}
