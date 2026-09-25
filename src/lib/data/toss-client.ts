// T-002 (seed-v3, AC-002) — 토스페이먼츠 REST API 서버 클라이언트.
// npm SDK 없이 순수 fetch로 호출한다 — 토스 공식 문서 확인 결과 서버 쪽 빌링
// API는 REST 호출만으로 충분하다(docs/TRD.md "seed-v3" §15 리서치 결론).
// TOSS_SECRET_KEY는 이 파일에서만 다룬다 — 절대 로그에 찍거나 다른 레이어로
// 넘기지 않는다 (Navigator 리뷰 지적사항).
export class MissingTossEnvError extends Error {
  constructor(missing: string[]) {
    super(`Missing required Toss Payments environment variable(s): ${missing.join(", ")}`);
    this.name = "MissingTossEnvError";
  }
}

export class TossApiError extends Error {
  status: number;
  tossCode?: string;
  constructor(message: string, status: number, tossCode?: string) {
    super(message);
    this.name = "TossApiError";
    this.status = status;
    this.tossCode = tossCode;
  }
}

function readSecretKey(): string {
  const secretKey = process.env.TOSS_SECRET_KEY;
  if (!secretKey) throw new MissingTossEnvError(["TOSS_SECRET_KEY"]);
  return secretKey;
}

function authHeader(secretKey: string): string {
  return `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
}

const TOSS_API_BASE = "https://api.tosspayments.com/v1";

export interface IssuedBillingKey {
  billingKey: string;
  cardLast4: string;
}

/**
 * authKey(클라이언트의 requestBillingAuth 성공 콜백에서 받은 일회성 인증 키)를
 * billingKey로 교환한다. 실패(비-2xx)는 TossApiError로 통일해 던진다 — 호출부
 * (subscription-service)가 도메인 에러로 다시 감싼다.
 */
export async function issueBillingKey(authKey: string, customerKey: string): Promise<IssuedBillingKey> {
  const secretKey = readSecretKey();
  const res = await fetch(`${TOSS_API_BASE}/billing/authorizations/issue`, {
    method: "POST",
    headers: { Authorization: authHeader(secretKey), "Content-Type": "application/json" },
    body: JSON.stringify({ authKey, customerKey }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new TossApiError(
      `빌링키 발급에 실패했습니다: ${body?.message ?? res.statusText}`,
      res.status,
      body?.code
    );
  }

  return {
    billingKey: body.billingKey as string,
    // 카드번호는 마스킹된 형태로만 내려온다(card.number, 예: "123456**-****-1234").
    // 정확한 마스킹 패턴은 토스 실제 응답으로 검증 전이라 "보이는 마지막 4자리
    // 숫자"를 최선 노력으로 추출한다 — manual_verification_checklist 대상.
    cardLast4: extractLast4Digits(body.card?.number as string | undefined),
  };
}

function extractLast4Digits(maskedCardNumber: string | undefined): string {
  if (!maskedCardNumber) return "????";
  const digits = maskedCardNumber.match(/\d/g) ?? [];
  return digits.slice(-4).join("").padStart(4, "?");
}

export interface ChargeBillingParams {
  customerKey: string;
  amount: number;
  orderId: string;
  orderName: string;
  // ⚠️ 이중 청구 방어(2026-09-16, /evolve Researcher 리뷰) — 앱 레벨 락
  // (claimBillingSlot/markPastDueAsExpired)이 뚫리거나 애초에 존재하지 않는
  // 경로(예: canceled/expired 기원 재구독)에서도, 같은 idempotencyKey로 온
  // 요청은 토스 서버 자체가 중복 처리를 막아준다(최대 300자, 15일 유효 —
  // 토스 공식 문서). 호출부가 "이 청구가 논리적으로 몇 번째 시도인지"를
  // 결정론적으로 표현해 전달한다. 앱 레벨 락을 대체하는 게 아니라 보완하는
  // defense-in-depth다.
  idempotencyKey: string;
}

export interface ChargeBillingResult {
  paymentKey: string;
  approvedAt: string;
}

/**
 * (seed-v3, AC-008, AC-004) 등록된 billingKey로 즉시 청구한다 — 재구독의 동기적
 * 청구(AC-008)와 일일 스케줄러의 정기결제(AC-004) 양쪽에서 재사용한다.
 * 실패는 issueBillingKey와 동일하게 TossApiError로 통일해 던진다.
 */
export async function chargeBilling(billingKey: string, params: ChargeBillingParams): Promise<ChargeBillingResult> {
  const secretKey = readSecretKey();
  const { idempotencyKey, ...chargeParams } = params;
  const res = await fetch(`${TOSS_API_BASE}/billing/${billingKey}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(secretKey),
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(chargeParams),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new TossApiError(`결제에 실패했습니다: ${body?.message ?? res.statusText}`, res.status, body?.code);
  }

  return {
    paymentKey: body.paymentKey as string,
    approvedAt: body.approvedAt as string,
  };
}
