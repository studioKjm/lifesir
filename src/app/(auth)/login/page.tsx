import Link from "next/link";
import { signInAction } from "./actions";

export const metadata = { title: "로그인 — 동행" };

const ERROR_COPY: Record<string, string> = {
  INVALID_INPUT: "이메일과 비밀번호를 입력해주세요.",
  INVALID_CREDENTIALS: "이메일 또는 비밀번호가 올바르지 않아요.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  const errorCode = Array.isArray(error) ? error[0] : error;

  return (
    <div className="card">
      <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 6 }}>로그인</h1>
      <p style={{ color: "var(--ink-muted)", fontSize: 14, marginBottom: 24 }}>다시 만나서 반가워요.</p>

      {errorCode && (
        <div role="alert" style={{ marginBottom: 16 }}>
          <p>{ERROR_COPY[errorCode] ?? "알 수 없는 오류가 발생했어요."}</p>
        </div>
      )}

      <form action={signInAction} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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

      <p style={{ textAlign: "center", fontSize: 13, color: "var(--ink-muted)", marginTop: 20 }}>
        아직 계정이 없으신가요? <Link href="/signup" style={{ color: "var(--blue)", fontWeight: 700 }}>회원가입</Link>
      </p>
    </div>
  );
}
