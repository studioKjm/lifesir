// T-003 (seed-v2) — 브라우저 Supabase 클라이언트 팩토리 환경변수 검증
import { describe, expect, it, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("createBrowserSupabaseClient", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("NEXT_PUBLIC_SUPABASE_URL이 없으면 MissingSupabasePublicEnvError를 던진다", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    const { createBrowserSupabaseClient, MissingSupabasePublicEnvError } = await import(
      "@/lib/supabase-browser"
    );
    expect(() => createBrowserSupabaseClient()).toThrow(MissingSupabasePublicEnvError);
  });

  it("NEXT_PUBLIC_SUPABASE_ANON_KEY가 없으면 MissingSupabasePublicEnvError를 던진다", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { createBrowserSupabaseClient, MissingSupabasePublicEnvError } = await import(
      "@/lib/supabase-browser"
    );
    expect(() => createBrowserSupabaseClient()).toThrow(MissingSupabasePublicEnvError);
  });

  it("둘 다 있으면 클라이언트를 생성한다", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    const { createBrowserSupabaseClient } = await import("@/lib/supabase-browser");
    expect(() => createBrowserSupabaseClient()).not.toThrow();
  });
});
