// T-012 (seed-v3, AC-002) — 브라우저 전용 토스페이먼츠 SDK 로더 + 빌링 인증 트리거.
// NEXT_PUBLIC_TOSS_CLIENT_KEY(퍼블릭 키)만 쓴다 — TOSS_SECRET_KEY(서버 전용)는
// 여기 절대 들어오지 않는다.
//
// 의도적으로 src/lib/data 밖에 둔다: src/components는 boundaries.yaml 규칙상
// src/lib/data를 import할 수 없는데(서버 전용 Data 레이어), 이 모듈은 퍼블릭 키
// 공개 클라이언트라 그 규칙의 취지(DB/시크릿 직접 접근 금지) 대상이 아니다 —
// src/lib/supabase-browser.ts(seed-v2)와 동일한 선례.
export class MissingTossPublicEnvError extends Error {
  constructor(missing: string[]) {
    super(`Missing required Toss Payments public environment variable(s): ${missing.join(", ")}`);
    this.name = "MissingTossPublicEnvError";
  }
}

const TOSS_SDK_SRC = "https://js.tosspayments.com/v2/standard";

declare global {
  interface Window {
    TossPayments?: (clientKey: string) => {
      payment(options: { customerKey: string }): {
        requestBillingAuth(options: {
          method: "CARD";
          successUrl: string;
          failUrl: string;
          customerEmail?: string;
          customerName?: string;
        }): Promise<void>;
      };
    };
  }
}

function loadTossSdk(): Promise<NonNullable<Window["TossPayments"]>> {
  if (window.TossPayments) return Promise.resolve(window.TossPayments);

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TOSS_SDK_SRC}"]`);
    const script = existing ?? document.createElement("script");
    if (!existing) {
      script.src = TOSS_SDK_SRC;
      document.head.appendChild(script);
    }
    script.addEventListener("load", () => {
      if (window.TossPayments) resolve(window.TossPayments);
      else reject(new Error("토스페이먼츠 SDK 로드에 실패했습니다"));
    });
    script.addEventListener("error", () => reject(new Error("토스페이먼츠 SDK 스크립트를 불러올 수 없습니다")));
  });
}

export interface RequestBillingAuthParams {
  customerKey: string;
  successUrl: string;
  failUrl: string;
  customerEmail?: string;
  customerName?: string;
}

/** 카드 등록(빌링키 발급) 화면으로 리다이렉트를 시작한다 — 성공/실패는 successUrl/failUrl로 돌아온다. */
export async function requestBillingAuth(params: RequestBillingAuthParams): Promise<void> {
  const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
  if (!clientKey) throw new MissingTossPublicEnvError(["NEXT_PUBLIC_TOSS_CLIENT_KEY"]);

  const TossPayments = await loadTossSdk();
  const payment = TossPayments(clientKey).payment({ customerKey: params.customerKey });
  await payment.requestBillingAuth({
    method: "CARD",
    successUrl: params.successUrl,
    failUrl: params.failUrl,
    customerEmail: params.customerEmail,
    customerName: params.customerName,
  });
}
