// T-001 — 서버 전용 Supabase 클라이언트 팩토리.
// service role key를 사용하므로 절대 클라이언트(브라우저)에 노출하지 않는다.
// src/app, src/components에서 직접 import 금지 (boundaries.yaml 게이트가 강제).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import NodeWebSocket from "ws";

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

/** 테스트 전용 — 캐시된 클라이언트를 초기화한다. */
export function resetSupabaseClientForTests(): void {
  cachedClient = null;
}
