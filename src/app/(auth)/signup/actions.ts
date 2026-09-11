"use server";

// T-019 — 회원가입 Server Action. 얇은 어댑터로만 두고(TRD 4장 결정), 실제 로직은
// auth-service(Logic)에 있다.
import { redirect } from "next/navigation";
import * as authService from "@/services/auth-service";
import { setSessionCookie } from "@/app/_lib/session";

export async function signUpAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const birthDate = String(formData.get("birthDate") ?? "");

  if (!email || !password || !name || !birthDate) {
    redirect("/signup?error=INVALID_INPUT");
  }
  if (password.length < 8) {
    redirect("/signup?error=WEAK_PASSWORD");
  }

  let result;
  try {
    result = await authService.signUp({ email, password, name, birthDate });
  } catch (err) {
    if (err instanceof authService.AuthError) {
      redirect(`/signup?error=${err.code}`);
    }
    throw err;
  }

  await setSessionCookie(result.session);
  redirect("/dashboard");
}
