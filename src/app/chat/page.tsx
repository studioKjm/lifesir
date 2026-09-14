import { redirect } from "next/navigation";
import { getSession } from "@/app/_lib/session";
import { AppShell } from "@/components/AppShell";
import { ChatWindow } from "@/components/ChatWindow";
import { OnboardingBanner } from "@/components/OnboardingBanner";
import styles from "./chat.module.css";

export const metadata = { title: "AI 상담 — 동행" };

export default async function ChatPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <AppShell active="chat" user={session}>
      <h1 className="page-title">AI 코치와 대화하기</h1>
      <p className="page-subtitle">연령대에 맞춰 다르게 답하는 AI 코치가 최근 건강 기록을 참고해 답변해요.</p>

      {!session.agentPersonaId && <OnboardingBanner />}

      <div className={`card ${styles.chatCard}`}>
        <ChatWindow />
      </div>
    </AppShell>
  );
}
