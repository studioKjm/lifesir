"use server";

// T-020 — CareLink 요청/응답 Server Action (AC-003).
import { redirect } from "next/navigation";
import * as careLinkService from "@/services/care-link-service";
import { getSession } from "@/app/_lib/session";

export async function requestCareLinkAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");

  const targetEmail = String(formData.get("targetEmail") ?? "").trim();
  if (!targetEmail) redirect("/care-links?error=INVALID_INPUT");

  try {
    await careLinkService.requestCareLink(session.id, targetEmail);
  } catch (err) {
    if (err instanceof careLinkService.CareLinkError) {
      redirect(`/care-links?error=${err.code}`);
    }
    throw err;
  }

  redirect("/care-links");
}

export async function respondCareLinkAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");

  const careLinkId = String(formData.get("careLinkId") ?? "");
  const decision = formData.get("decision") === "accept" ? "accept" : "reject";

  try {
    await careLinkService.respondCareLink(session.id, careLinkId, decision);
  } catch (err) {
    if (err instanceof careLinkService.CareLinkError) {
      redirect(`/care-links?error=${err.code}`);
    }
    throw err;
  }

  redirect("/care-links");
}
