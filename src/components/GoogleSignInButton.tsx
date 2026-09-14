"use client";

// T-011 (seed-v2, AC-001) — "구글로 계속하기" 버튼.
// signInWithOAuth()는 DB 조회나 비즈니스 로직이 아니라 브라우저를 구글 동의화면
// 으로 보내는 것뿐이라 <a href>와 기능적으로 동급이다 — 그래서 anon key 전용
// 브라우저 클라이언트(src/lib/supabase-browser, Data 레이어 아님)를 여기서
// 직접 호출한다. docs/TRD.md "seed-v2" §9.1 참고.
import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";
import styles from "./GoogleSignInButton.module.css";

export function GoogleSignInButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (oauthError) {
        setError("구글 로그인을 시작할 수 없어요. 잠시 후 다시 시도해주세요.");
        setPending(false);
      }
      // 성공 시 브라우저가 구글 동의화면으로 이동하므로 여기서 할 일이 없다.
    } catch {
      setError("구글 로그인을 시작할 수 없어요. 잠시 후 다시 시도해주세요.");
      setPending(false);
    }
  }

  return (
    <div>
      <div className={styles.divider}>또는</div>
      <button type="button" className={styles.button} onClick={handleClick} disabled={pending}>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.87 2.69-6.62z"
          />
          <path
            fill="#34A853"
            d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z"
          />
          <path
            fill="#FBBC05"
            d="M3.96 10.71a5.4 5.4 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33z"
          />
          <path
            fill="#EA4335"
            d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"
          />
        </svg>
        {pending ? "이동 중..." : "Google로 계속하기"}
      </button>
      {error && (
        <p role="alert" style={{ color: "var(--red)", fontSize: 13, marginTop: 10, textAlign: "center" }}>
          {error}
        </p>
      )}
    </div>
  );
}
