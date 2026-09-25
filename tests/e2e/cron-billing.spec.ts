// T-019 (seed-v3, AC-004, AC-005, AC-007) — /api/cron/billing 인증 E2E.
// 실제 배치 실행(토스 청구)은 sandbox 키가 있을 때만 유의미하므로, 여기서는
// CRON_SECRET 인증 게이트와 두 배치(billing/expired)가 모두 호출되는지만
// 검증한다 — 배치 로직 자체(성공/실패/부분실패/루프 격리)는
// tests/unit/services/billing-service.test.ts가 이미 충분히 다룬다.
import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(import.meta.dirname, "../../.env.local") });

import { test, expect } from "@playwright/test";

test.describe("/api/cron/billing 인증 (AC-004, AC-005)", () => {
  test("Authorization 헤더 없이 호출하면 401", async ({ request }) => {
    const res = await request.get("/api/cron/billing");
    expect(res.status()).toBe(401);
  });

  test("잘못된 시크릿으로 호출하면 401", async ({ request }) => {
    const res = await request.get("/api/cron/billing", {
      headers: { Authorization: "Bearer wrong-secret" },
    });
    expect(res.status()).toBe(401);
  });

  test("올바른 CRON_SECRET이면 200과 함께 billing/expired 두 배치 결과를 모두 반환한다", async ({ request }) => {
    const secret = process.env.CRON_SECRET;
    expect(secret, "CRON_SECRET이 .env.local에 설정되어 있어야 한다").toBeTruthy();

    const res = await request.get("/api/cron/billing", {
      headers: { Authorization: `Bearer ${secret}` },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.billing)).toBe(true);
    expect(Array.isArray(body.expired)).toBe(true);
  });
});
