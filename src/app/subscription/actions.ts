"use server";

// T-016 (seed-v3, AC-006, AC-008) — 구독 해지/재구독 Server Action. 얇은
// 어댑터로만 두고 실제 로직(대상 특정, 상태 전이, 토스 청구)은
// subscription-service(Logic)에 있다.
import { redirect } from "next/navigation";
import { getSession } from "@/app/_lib/session";
import * as subscriptionService from "@/services/subscription-service";
import type { SubscriptionPlan } from "@/types/dto";

export async function cancelSubscriptionAction() {
  const session = await getSession();
  if (!session) redirect("/login");

  try {
    await subscriptionService.cancelSubscription(session.id);
  } catch (err) {
    if (err instanceof subscriptionService.SubscriptionError) {
      redirect(`/subscription?error=${err.code}`);
    }
    throw err;
  }

  redirect("/subscription");
}

const VALID_PLANS: SubscriptionPlan[] = ["monthly", "yearly"];

export async function resubscribeAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");

  const planValue = String(formData.get("plan") ?? "");
  const plan = VALID_PLANS.includes(planValue as SubscriptionPlan) ? (planValue as SubscriptionPlan) : null;
  if (!plan) redirect("/subscription?error=INVALID_INPUT");

  try {
    await subscriptionService.resubscribe(session.id, plan);
  } catch (err) {
    if (err instanceof subscriptionService.SubscriptionError) {
      redirect(`/subscription?error=${err.code}`);
    }
    throw err;
  }

  redirect("/subscription");
}
