// T-001 — 서버 전용 Supabase 클라이언트 팩토리.
// service role key를 사용하므로 절대 클라이언트(브라우저)에 노출하지 않는다.
// src/app, src/components에서 직접 import 금지 (boundaries.yaml 게이트가 강제).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import NodeWebSocket from "ws";
import type { SupabaseCookieAdapter } from "@/types/dto";

// Node 20은 네이티브 WebSocket이 없어 supabase-js의 내부 Realtime 클라이언트
// 초기화가 실패한다. 이 프로젝트는 Realtime을 쓰지 않지만(부모 대시보드는
// polling — TRD 6장 결정), 생성자가 무조건 초기화를 시도하므로 폴리필이 필요하다.
if (typeof globalThis.WebSocket === "undefined") {
  // @ts-expect-error - ws는 Node용 WebSocket 폴리필이다
  globalThis.WebSocket = NodeWebSocket;
}

export class MissingSupabaseEnvError extends Error {
  constructor(missing: string[]) {
    super(`Missing required Supabase environment variable(s): ${missing.join(", ")}`);
    this.name = "MissingSupabaseEnvError";
  }
}

let cachedClient: SupabaseClient | null = null;

function readEnv(): { url: string; serviceRoleKey: string } {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const missing: string[] = [];
  if (!url) missing.push("SUPABASE_URL");
  if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length > 0) {
    throw new MissingSupabaseEnvError(missing);
  }

  return { url: url as string, serviceRoleKey: serviceRoleKey as string };
}

/** 서버 전용 Supabase 클라이언트를 반환한다 (싱글턴). */
export function getSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const { url, serviceRoleKey } = readEnv();
  cachedClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedClient;
}

/**
 * `signInWithPassword`/`auth.getUser(token)` 같은 GoTrue 메서드는 호출한 클라이언트
 * 인스턴스의 내부 세션을 그 자리에서 바꿔버린다. getSupabaseClient()는 모든 요청이
 * 공유하는 프로세스 전역 싱글턴이므로, 그 인스턴스에서 이런 메서드를 부르면 그
 * 순간부터 (같은 프로세스에서 처리되는) 다른 모든 요청의 Data 레이어 쿼리가 방금
 * 로그인한 사용자의 권한(authenticated 롤)으로 실행되어버린다 — service_role
 * 권한이 조용히 사라지는 세션 유출 버그다 (2026-09-11 실제 E2E에서 발견: 로그인
 * 직후부터 모든 사용자의 대시보드 조회가 "permission denied for table users"로
 * 실패했다). 이런 메서드는 반드시 이 함수로 얻은, 캐시되지 않는 일회용 클라이언트
 * 에서만 호출한다.
 */
export function createAuthClient(): SupabaseClient {
  const { url, serviceRoleKey } = readEnv();
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function readPublicEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (missing.length > 0) {
    throw new MissingSupabaseEnvError(missing);
  }

  return { url: url as string, anonKey: anonKey as string };
}

/**
 * T-002 (seed-v2) — 쿠키 기반 세션을 다루는 @supabase/ssr 서버 클라이언트.
 * anon key만 사용한다(service_role 아님) — RLS를 우회하지 않는다.
 *
 * 쿠키 읽기/쓰기는 Next.js 프레임워크(`next/headers`의 cookies(), 또는 proxy의
 * request/response)에 묶여 있는데, 이 파일(Data 레이어)은 boundaries.yaml 규칙상
 * `next/*`를 import할 수 없다. 그래서 실제 쿠키 접근은 호출부(Presentation:
 * Server Action/Route Handler/proxy.ts)가 만들어서 `cookieAdapter` 인자로
 * 넘긴다 — 이 함수는 그 어댑터가 무엇으로 구현됐는지 전혀 모른다.
 *
 * `getSupabaseClient()`와 달리 절대 캐싱하지 않는다 — 사용자마다, 요청마다
 * 다른 쿠키(세션)를 담아야 하는 클라이언트를 캐싱하면 세션이 서로 섞인다
 * (createAuthClient()의 주석에 기록된 것과 같은 클래스의 버그).
 */
export function createServerSupabaseClient(cookieAdapter: SupabaseCookieAdapter): SupabaseClient {
  const { url, anonKey } = readPublicEnv();
  return createServerClient(url, anonKey, { cookies: cookieAdapter });
}

/** 테스트 전용 — 캐시된 클라이언트를 초기화한다. */
export function resetSupabaseClientForTests(): void {
  cachedClient = null;
}
