// T-009 (seed-v2, AC-005) — 세션 게이트, @supabase/ssr 표준 패턴으로 재작성.
// Next.js 16부터 "middleware" 파일 컨벤션이 "proxy"로 이름이 바뀌었다
// (node_modules/next/dist/docs/.../proxy.md 참고, 함수명도 proxy로 변경됨).
//
// Supabase 공식 Next.js 가이드가 이 프로젝트와 동일하게 "Proxy"라는 용어를
// 쓴다 — Proxy의 역할은 만료 임박 세션을 갱신하고(auth.getUser() 호출이
// refresh token 갱신을 트리거한다), 세션이 없으면 /login으로 보내는 것뿐이다.
// ARCHITECTURE_INVARIANTS.md Part 2 각주에 명시된 대로, 여기서 @supabase/ssr
// 클라이언트를 직접 만드는 것은 예외로 허용되지만 DB 테이블 조회는 하지 않는다.
//
// 커스텀 쿠키(AUTH_COOKIE_NAME) 기반 게이트는 seed-v2에서 걷어냈다.
import { NextResponse, type NextRequest } from "next/server.js";
import { createServerSupabaseClient } from "@/lib/data/supabase-client";

export async function proxy(request: NextRequest) {
  // Supabase 공식 패턴: 쿠키를 request와 response 양쪽에 반영해야 한다. 갱신된
  // 쿠키를 request에만 쓰고 response를 새로 만들지 않으면, 하위 Server
  // Component가 갱신 전 쿠키를 보게 되는 문제가 생긴다(공식 문서에 명시된
  // 알려진 함정).
  let response = NextResponse.next({ request });

  const supabase = createServerSupabaseClient({
    getAll() {
      return request.cookies.getAll();
    },
    setAll(cookiesToSet) {
      for (const { name, value } of cookiesToSet) {
        request.cookies.set(name, value);
      }
      response = NextResponse.next({ request });
      for (const { name, value, options } of cookiesToSet) {
        response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
      }
    },
  });

  // matcher가 이미 보호된 경로로만 좁혀놓았으므로(아래 config), 여기 도달했다는
  // 것 자체가 "이 경로는 세션이 필요하다"는 뜻이다. fail-closed: 세션 조회 자체가
  // 실패하거나(네트워크 등) 세션이 없으면 통과시키지 않는다.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/care-links/:path*", "/chat/:path*", "/onboarding/:path*"],
};
