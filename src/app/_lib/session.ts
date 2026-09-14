// T-010 (seed-v2, AC-005) — 페이지/Server Action 공용 세션 조회 헬퍼.
// src/proxy.ts는 세션 존재/유효성만 얕게 확인하는 UX 게이트다. 여기서 실제
// 신뢰 가능한 userId를 얻는다: 요청 쿠키를 담은 어댑터를 Logic 레이어
// (auth-service)에 넘겨 검증한다. src/app은 boundaries.yaml 규칙상 Data
// 레이어(@supabase/ssr 포함)를 직접 import할 수 없으므로 반드시 이 경로
// (Presentation → Logic)로만 세션을 조회한다.
//
// 커스텀 쿠키(AUTH_COOKIE_NAME) 기반 세션 모델은 seed-v2에서 걷어냈다 — 세션은
// 이제 auth-service의 signUp/signIn/signOut이 @supabase/ssr 클라이언트를 통해
// 직접 심고 지운다(setSessionCookie/clearSessionCookie 같은 별도 함수가 필요 없다).
import { cookies } from "next/headers";
import { getSessionUser } from "@/services/auth-service";
import type { SupabaseCookieAdapter } from "@/types/dto";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  // seed-v2, AC-004 — 온보딩 완료 여부를 페이지가 판단할 수 있도록 추가.
  agentPersonaId: string | null;
  birthDate: string | null;
}

/**
 * next/headers의 cookies()로 SupabaseCookieAdapter를 만든다. Server
 * Component에서는 쿠키를 쓸 수 없어 setAll이 실패할 수 있는데, 이건 정상이다
 * (세션 갱신은 proxy.ts가 매 요청마다 이미 담당한다 — Supabase 공식 문서의
 * 권장 패턴) — 그래서 setAll 실패는 조용히 무시한다.
 */
export async function buildCookieAdapter(): Promise<SupabaseCookieAdapter> {
  const cookieStore = await cookies();
  return {
    getAll() {
      return cookieStore.getAll();
    },
    setAll(cookiesToSet) {
      try {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      } catch {
        // Server Component에서 호출된 경우 — 위 주석 참고, 무시해도 안전하다.
      }
    },
  };
}

/** 로그인 상태면 사용자를, 아니면 null을 반환한다. */
export async function getSession(): Promise<SessionUser | null> {
  return getSessionUser(await buildCookieAdapter());
}
