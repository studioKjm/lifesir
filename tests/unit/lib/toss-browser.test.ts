// T-012 (seed-v3) — 브라우저 토스페이먼츠 클라이언트 환경변수 검증
import { describe, expect, it, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("requestBillingAuth", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("NEXT_PUBLIC_TOSS_CLIENT_KEY가 없으면 MissingTossPublicEnvError를 던진다", async () => {
    delete process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
    const { requestBillingAuth, MissingTossPublicEnvError } = await import("@/lib/toss-browser");

    await expect(
      requestBillingAuth({ customerKey: "u-1", successUrl: "http://x/success", failUrl: "http://x/fail" })
    ).rejects.toBeInstanceOf(MissingTossPublicEnvError);
  });
});
