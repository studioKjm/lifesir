// T-003 (seed-v2, AC-001) — 브라우저 전용 Supabase 클라이언트.
// anon key만 쓴다(서비스 롤 절대 아님) — DB에 직접 접근하지 않고, 여기서 할 일은
// signInWithOAuth()로 구글 동의화면으로 리다이렉트를 시작하는 것뿐이다.
//
// 의도적으로 src/lib/data 밖에 둔다: src/components는 boundaries.yaml 규칙상
// src/lib/data를 import할 수 없는데(서버 전용 Data 레이어), 이 모듈은 anon key
// 공개 클라이언트라 그 규칙의 취지(DB/서비스 롤 직접 접근 금지) 대상이 아니다.
// docs/TRD.md "seed-v2" §9.1 참고.
import { createBrowserClient } from "@supabase/ssr";

export class MissingSupabasePublicEnvError extends Error {
  constructor(missing: string[]) {
    super(`Missing required Supabase public environment variable(s): ${missing.join(", ")}`);
    this.name = "MissingSupabasePublicEnvError";
  }
}

export function createBrowserSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (missing.length > 0) {
    throw new MissingSupabasePublicEnvError(missing);
  }

  return createBrowserClient(url as string, anonKey as string);
}
