// T-024 — 부모 대시보드 polling용 JSON 엔드포인트 (AC-007). 얇은 어댑터로만 두고
// 실제 권한 재검증/집계는 src/services에 있다(TRD 4장 결정).
import { NextResponse } from "next/server.js";
import { getSession } from "@/app/_lib/session";
import * as careLinkService from "@/services/care-link-service";
import * as dashboardService from "@/services/dashboard-service";
import { CareLinkError } from "@/services/care-link-service";

export async function GET(_request: Request, { params }: { params: Promise<{ careLinkId: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const { careLinkId } = await params;
  const link = await careLinkService.getCareLinkById(careLinkId);
  if (!link) {
    return NextResponse.json({ error: "LINK_NOT_FOUND" }, { status: 404 });
  }

  try {
    const view = await dashboardService.getParentDashboard(session.id, link.targetUserId);
    return NextResponse.json(view);
  } catch (err) {
    if (err instanceof CareLinkError) {
      return NextResponse.json({ error: err.code }, { status: 403 });
    }
    throw err;
  }
}
