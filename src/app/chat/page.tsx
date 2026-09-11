import { redirect } from "next/navigation";
import { getSession } from "@/app/_lib/session";
import { AppShell } from "@/components/AppShell";
import { ChatWindow } from "@/components/ChatWindow";

export const metadata = { title: "AI 상담 — 동행" };

export default async function ChatPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <AppShell active="chat" user={session}>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 6 }}>AI 코치와 대화하기</h1>
      <p style={{ color: "var(--ink-muted)", fontSize: 14, marginBottom: 20 }}>
        연령대에 맞춰 다르게 답하는 AI 코치가 최근 건강 기록을 참고해 답변해요.
      </p>

      <div className="card" style={{ maxWidth: 720 }}>
        <ChatWindow />
      </div>
    </AppShell>
  );
}
