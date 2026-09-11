"use server";

// T-019 — 로그아웃은 별도 AC가 없지만, 쿠키를 심는 signUp/signIn과 짝을 이루는
// 최소 동작이라 AppShell이 재사용할 수 있게 여기 둔다.
import { redirect } from "next/navigation";
import { clearSessionCookie } from "@/app/_lib/session";

export async function logoutAction() {
  await clearSessionCookie();
  redirect("/login");
}
