"use server";

import { redirect } from "next/navigation";
import * as authService from "@/services/auth-service";
import { setSessionCookie } from "@/app/_lib/session";

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/login?error=INVALID_INPUT");
  }

  let result;
  try {
    result = await authService.signIn({ email, password });
  } catch (err) {
    if (err instanceof authService.AuthError) {
      redirect(`/login?error=${err.code}`);
    }
    throw err;
  }

  await setSessionCookie(result.session);
  redirect("/dashboard");
}
