"use server";

// T-021 — HealthLog 기록 Server Action (AC-005). 본인 기록이 기본이며,
// targetUserId가 formData에 있으면 대리입력(health-log-service가 CareLink
// accepted 여부를 가드)로 처리된다. 대리입력은 부모 대시보드 페이지
// (/dashboard/[careLinkId])에서 제출되므로, careLinkId가 함께 오면 제출 후
// 본인 대시보드가 아니라 그 페이지로 되돌아간다.
import { redirect } from "next/navigation";
import * as healthLogService from "@/services/health-log-service";
import { CareLinkError } from "@/services/care-link-service";
import { getSession } from "@/app/_lib/session";
import type { HealthLogType } from "@/types/dto";

export async function recordHealthLogAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");

  const logType = String(formData.get("logType") ?? "") as HealthLogType;
  const value = String(formData.get("value") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  const loggedAt = String(formData.get("loggedAt") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const targetUserId = String(formData.get("targetUserId") ?? "").trim() || undefined;
  const careLinkId = String(formData.get("careLinkId") ?? "").trim() || undefined;
  const returnPath = careLinkId ? `/dashboard/${careLinkId}` : "/dashboard";

  if (!logType || !value || !loggedAt) {
    redirect(`${returnPath}?error=INVALID_INPUT`);
  }

  try {
    await healthLogService.recordHealthLog(session.id, {
      targetUserId,
      logType,
      value,
      unit: unit || undefined,
      loggedAt: new Date(loggedAt).toISOString(),
      note: note || undefined,
    });
  } catch (err) {
    if (err instanceof CareLinkError) {
      redirect(`${returnPath}?error=${err.code}`);
    }
    throw err;
  }

  redirect(returnPath);
}
