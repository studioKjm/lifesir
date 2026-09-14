"use server";

// T-015 (seed-v2, AC-006) — 로그아웃. AppShell이 재사용한다.
// signOut()이 쿠키 삭제뿐 아니라 서버 측 refresh token도 무효화한다(auth-service 참고).
import { redirect } from "next/navigation";
import { signOut } from "@/services/auth-service";
import { buildCookieAdapter } from "@/app/_lib/session";

export async function logoutAction() {
  await signOut(await buildCookieAdapter());
  redirect("/login");
}
