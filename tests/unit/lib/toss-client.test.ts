import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueBillingKey, chargeBilling, MissingTossEnvError, TossApiError } from "@/lib/data/toss-client";

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: "",
      json: async () => body,
    })
  );
}

describe("toss-client.issueBillingKey (AC-002)", () => {
  const originalSecretKey = process.env.TOSS_SECRET_KEY;

  beforeEach(() => {
    process.env.TOSS_SECRET_KEY = "test_secret_key";
  });

  afterEach(() => {
    process.env.TOSS_SECRET_KEY = originalSecretKey;
    vi.unstubAllGlobals();
  });

  it("TOSS_SECRET_KEY가 없으면 MissingTossEnvError", async () => {
    delete process.env.TOSS_SECRET_KEY;
    await expect(issueBillingKey("auth-key", "customer-key")).rejects.toBeInstanceOf(MissingTossEnvError);
  });

  it("성공 시 billingKey와 마스킹된 카드번호에서 뒤 4자리를 추출해 반환한다", async () => {
    mockFetchOnce(200, { billingKey: "billing_abc123", card: { number: "12341234****1234" } });

    const result = await issueBillingKey("auth-key", "customer-key");

    expect(result.billingKey).toBe("billing_abc123");
    expect(result.cardLast4).toBe("1234");
  });

  it("Authorization 헤더가 Basic base64(secretKey:) 형식이다 (시크릿 노출 없이)", async () => {
    mockFetchOnce(200, { billingKey: "billing_abc123", card: { number: "1234****" } });

    await issueBillingKey("auth-key", "customer-key");

    const call = vi.mocked(fetch).mock.calls[0];
    const headers = call[1]?.headers as Record<string, string>;
    const expected = `Basic ${Buffer.from("test_secret_key:").toString("base64")}`;
    expect(headers.Authorization).toBe(expected);
  });

  it("비-2xx 응답은 TossApiError로 던진다 (시크릿/원본 응답을 그대로 노출하지 않음)", async () => {
    mockFetchOnce(400, { message: "유효하지 않은 authKey", code: "INVALID_AUTH_KEY" });

    await expect(issueBillingKey("bad-key", "customer-key")).rejects.toBeInstanceOf(TossApiError);
  });
});

describe("toss-client.chargeBilling (AC-008, AC-004)", () => {
  const originalSecretKey = process.env.TOSS_SECRET_KEY;

  beforeEach(() => {
    process.env.TOSS_SECRET_KEY = "test_secret_key";
  });

  afterEach(() => {
    process.env.TOSS_SECRET_KEY = originalSecretKey;
    vi.unstubAllGlobals();
  });

  const params = {
    customerKey: "u-1",
    amount: 9900,
    orderId: "order-1",
    orderName: "동행 AI 코치 구독",
    idempotencyKey: "billing:sub-1:2026-09-16T00:00:00.000Z",
  };

  it("TOSS_SECRET_KEY가 없으면 MissingTossEnvError", async () => {
    delete process.env.TOSS_SECRET_KEY;
    await expect(chargeBilling("billing-key", params)).rejects.toBeInstanceOf(MissingTossEnvError);
  });

  it("성공 시 paymentKey/approvedAt을 반환하고 POST /v1/billing/{billingKey}로 요청한다", async () => {
    mockFetchOnce(200, { paymentKey: "pay_abc123", approvedAt: "2026-09-16T00:00:00+09:00" });

    const result = await chargeBilling("billing-key-xyz", params);

    expect(result.paymentKey).toBe("pay_abc123");
    expect(result.approvedAt).toBe("2026-09-16T00:00:00+09:00");
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe("https://api.tosspayments.com/v1/billing/billing-key-xyz");
  });

  it("Idempotency-Key 헤더로 idempotencyKey를 전달하고, 요청 바디에는 포함하지 않는다 (이중 청구 방어, /evolve)", async () => {
    mockFetchOnce(200, { paymentKey: "pay_abc123", approvedAt: "2026-09-16T00:00:00+09:00" });

    await chargeBilling("billing-key-xyz", params);

    const call = vi.mocked(fetch).mock.calls[0];
    const options = call[1] as RequestInit;
    const headers = options.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("billing:sub-1:2026-09-16T00:00:00.000Z");
    const sentBody = JSON.parse(options.body as string);
    expect(sentBody).not.toHaveProperty("idempotencyKey");
    expect(sentBody).toEqual({ customerKey: "u-1", amount: 9900, orderId: "order-1", orderName: "동행 AI 코치 구독" });
  });

  it("비-2xx 응답은 TossApiError로 던진다", async () => {
    mockFetchOnce(400, { message: "한도초과", code: "EXCEED_MAX_DAILY_PAYMENT_COUNT" });

    await expect(chargeBilling("billing-key", params)).rejects.toBeInstanceOf(TossApiError);
  });
});
