import { redirect } from "next/navigation";
import { getSession } from "@/app/_lib/session";
import { completeOnboardingAction } from "./actions";

export const metadata = { title: "생년월일 입력 — 동행" };

const ERROR_COPY: Record<string, string> = {
  INVALID_INPUT: "생년월일을 입력해주세요.",
};

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const session = await getSession();
  if (!session) redirect("/login");
  // 이미 온보딩을 완료한 유저(agentPersonaId 있음)라면 다시 볼 필요가 없다.
  if (session.agentPersonaId) redirect("/dashboard");

  const { error } = await searchParams;
  const errorCode = Array.isArray(error) ? error[0] : error;

  return (
    <div className="center-screen">
      <div className="card center-screen__panel">
        <h1 className="page-title" style={{ fontSize: 22 }}>
          생년월일을 알려주세요
        </h1>
        <p className="page-subtitle" style={{ marginBottom: 24 }}>
          연령대에 맞춰 AI 코치가 다르게 응답해요. {session.name}님, 한 번만 알려주시면 돼요.
        </p>

        {errorCode && (
          <div role="alert">
            <p>{ERROR_COPY[errorCode] ?? "알 수 없는 오류가 발생했어요."}</p>
          </div>
        )}

        <form action={completeOnboardingAction} className="form-stack">
          <div className="field">
            <label htmlFor="birthDate">생년월일</label>
            <input id="birthDate" name="birthDate" type="date" defaultValue={session.birthDate ?? ""} required />
          </div>
          <button type="submit" className="btn btn--primary btn--block">
            시작하기
          </button>
        </form>
      </div>
    </div>
  );
}
