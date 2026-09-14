"use server";

// T-013 (seed-v2, AC-004) — 온보딩 완료 Server Action.
import { redirect } from "next/navigation";
import * as authService from "@/services/auth-service";
import { getSession } from "@/app/_lib/session";

export async function completeOnboardingAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");

  const birthDate = String(formData.get("birthDate") ?? "");
  if (!birthDate) {
    redirect("/onboarding?error=INVALID_INPUT");
  }

  await authService.completeOnboarding(session.id, birthDate);
  redirect("/dashboard");
}
