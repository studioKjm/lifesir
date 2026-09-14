// T-009 (seed-v2, AC-005) — proxy의 세션 갱신 쿠키 relay 검증.
// 실제 만료 JWT를 위조해 E2E로 재현하려면 로컬 JWT_SECRET 서명, @supabase/ssr의
// 쿠키 청크/인코딩 포맷 등 불확실한 저수준 디테일이 너무 많아 오히려 취약하다.
// 대신 @supabase/ssr이 세션을 갱신할 때 실제로 하는 일(내부에서 우리가 넘긴
// cookieAdapter.setAll()을 호출하는 것)을 mock으로 재현해, proxy.ts가 그 결과를
// request/response 양쪽에 정확히 중계하는지 결정론적으로 검증한다 — Navigator가
// 지적한 "갱신된 쿠키가 응답에 실제로 실리는가"의 핵심 로직만 정확히 겨냥한다.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server.js";
import { proxy } from "@/proxy";
import { createServerSupabaseClient } from "@/lib/data/supabase-client";
import type { SupabaseCookieAdapter } from "@/types/dto";

vi.mock("@/lib/data/supabase-client");

describe("proxy — 세션 갱신 쿠키 relay (AC-005)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("만료 임박 세션이 갱신되면(auth.getUser 내부에서 setAll 호출), 갱신된 쿠키가 응답에 실리고 통과한다", async () => {
    vi.mocked(createServerSupabaseClient).mockImplementation((adapter: SupabaseCookieAdapter) => {
      return {
        auth: {
          // @supabase/ssr의 실제 동작: getUser() 호출 중 만료를 감지하면 refresh 후
          // storage adapter의 setAll을 호출해 새 세션을 저장한다.
          getUser: async () => {
            adapter.setAll([
              { name: "sb-127-auth-token", value: "refreshed-session-value", options: { path: "/" } },
            ]);
            return { data: { user: { id: "u1" } }, error: null };
          },
        },
      } as never;
    });

    const request = new NextRequest("http://127.0.0.1:3100/dashboard", {
      headers: { cookie: "sb-127-auth-token=old-expiring-value" },
    });

    const response = await proxy(request);

    // 리다이렉트가 아니라 통과해야 한다.
    expect(response.headers.get("location")).toBeNull();
    // 갱신된 쿠키가 응답에 실제로 반영돼야 한다 — 이게 안 되면 브라우저는 계속
    // 만료된 토큰을 들고 있게 되어 다음 요청에서 다시 갱신을 시도하다 결국
    // refresh token도 만료되면 로그아웃되는, 겉보기엔 "가끔 로그아웃되는" 버그가 된다.
    expect(response.cookies.get("sb-127-auth-token")?.value).toBe("refreshed-session-value");
  });

  it("세션이 없으면 /login으로 리다이렉트한다 (fail-closed)", async () => {
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: { message: "no session" } }) },
    } as never);

    const request = new NextRequest("http://127.0.0.1:3100/dashboard");
    const response = await proxy(request);

    expect(response.headers.get("location")).toContain("/login");
  });

  it("세션 조회 자체가 에러여도 통과시키지 않는다 (fail-closed, 정상 세션 있음으로 오인하지 않음)", async () => {
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: { message: "network error" } }) },
    } as never);

    const request = new NextRequest("http://127.0.0.1:3100/care-links");
    const response = await proxy(request);

    expect(response.headers.get("location")).toContain("/login");
  });
});
