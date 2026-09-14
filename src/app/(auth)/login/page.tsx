import Link from "next/link";
import { signInAction } from "./actions";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";

export const metadata = { title: "로그인 — 동행" };

const ERROR_COPY: Record<string, string> = {
  INVALID_INPUT: "이메일과 비밀번호를 입력해주세요.",
  INVALID_CREDENTIALS: "이메일 또는 비밀번호가 올바르지 않아요.",
  // seed-v2 AC-007 — 구글 동의화면 취소/실패
  OAUTH_CANCELLED: "구글 로그인이 취소됐어요.",
  OAUTH_EXCHANGE_FAILED: "구글 로그인에 실패했어요. 잠시 후 다시 시도해주세요.",
  OAUTH_EMAIL_NOT_VERIFIED: "이 구글 계정의 이메일이 인증되지 않아 기존 계정과 연결할 수 없어요.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  const errorCode = Array.isArray(error) ? error[0] : error;

  return (
    <div className="card">
      <h1 className="page-title" style={{ fontSize: 22 }}>
        로그인
      </h1>
      <p className="page-subtitle" style={{ marginBottom: 24 }}>
        다시 만나서 반가워요.
      </p>

      {errorCode && (
        <div role="alert">
          <p>{ERROR_COPY[errorCode] ?? "알 수 없는 오류가 발생했어요."}</p>
        </div>
      )}

      <form action={signInAction} className="form-stack">
        <div className="field">
          <label htmlFor="email">이메일</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="field">
          <label htmlFor="password">비밀번호</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <button type="submit" className="btn btn--primary btn--block">
          로그인
        </button>
      </form>

      <GoogleSignInButton />

      <p className="auth-footer">
        아직 계정이 없으신가요? <Link href="/signup">회원가입</Link>
      </p>
    </div>
  );
}
