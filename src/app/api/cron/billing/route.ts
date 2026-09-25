// T-019 (seed-v3, AC-004, AC-005, AC-007) — Vercel Cron이 매일 호출하는 진입점.
// 얇은 어댑터로만 두고 실제 로직은 billing-service(Logic)에 있다.
//
// 정기결제(runDailyBilling)와 만료정리(expireCanceledSubscriptions) 두 배치를
// 순서대로 호출하되 각각 독립적인 try/catch로 감싼다 — 서로 다른 status
// (trial/active vs canceled)를 대상으로 해 상호 간섭이 없으므로, 한쪽이
// (배치 내부 루프 격리로도 못 막는 상위 레벨 예외, 예: 조회 자체가 DB 연결
// 문제로 던지는 경우) 통째로 실패해도 다른 쪽은 계속 실행된다(Navigator Plan A).
//
// 세션 기반이 아니라 CRON_SECRET으로 인증한다 — 로그인한 사용자가 없는 시스템
// 호출이라 Logic의 userId 기반 권한 체계와 다른 층위. 단순 문자열 비교(===)는
// 타이밍 공격에 이론적으로 노출되므로 crypto.timingSafeEqual을 쓴다(Navigator
// 리뷰 지적사항) — 길이가 다르면 timingSafeEqual이 예외를 던지므로 길이 비교를
// 먼저 한다.
import { NextResponse, type NextRequest } from "next/server.js";
import { timingSafeEqual } from "node:crypto";
import * as billingService from "@/services/billing-service";

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // 시크릿 미설정이면 항상 거부한다 (fail-closed)

  const header = request.headers.get("authorization");
  if (!header) return false;

  const headerBuf = Buffer.from(header);
  const expectedBuf = Buffer.from(`Bearer ${secret}`);
  if (headerBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(headerBuf, expectedBuf);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let billing: Awaited<ReturnType<typeof billingService.runDailyBilling>> | { error: string };
  try {
    billing = await billingService.runDailyBilling();
  } catch (err) {
    console.error("[cron/billing] runDailyBilling 전체 실패", err);
    billing = { error: (err as Error).message };
  }

  let expired: Awaited<ReturnType<typeof billingService.expireCanceledSubscriptions>> | { error: string };
  try {
    expired = await billingService.expireCanceledSubscriptions();
  } catch (err) {
    console.error("[cron/billing] expireCanceledSubscriptions 전체 실패", err);
    expired = { error: (err as Error).message };
  }

  return NextResponse.json({ billing, expired });
}
