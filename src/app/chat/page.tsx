import { redirect } from "next/navigation";
import { getSession } from "@/app/_lib/session";
import * as subscriptionService from "@/services/subscription-service";
import { isAdminEmail } from "@/services/admin-service";
import { AppShell } from "@/components/AppShell";
import { ChatWindow } from "@/components/ChatWindow";
import { OnboardingBanner } from "@/components/OnboardingBanner";
import { SubscriptionRequiredNotice } from "@/components/SubscriptionRequiredNotice";
import styles from "./chat.module.css";

export const metadata = { title: "AI 상담 — 동행" };

export default async function ChatPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // seed-v3, AC-001 — 온보딩 배너(OnboardingBanner)와 독립적인 별개 게이트다.
  // 둘 다 사용자를 막지 않는 게 아니라, 구독 게이트는 실제로 ChatWindow 자체를
  // 대체한다(TRD §16.1).
  const access = await subscriptionService.checkAICoachAccess(session.id);

  return (
    <AppShell active="chat" user={session} isAdmin={isAdminEmail(session.email)}>
      <h1 className="page-title">AI 코치와 대화하기</h1>
      <p className="page-subtitle">연령대에 맞춰 다르게 답하는 AI 코치가 최근 건강 기록을 참고해 답변해요.</p>

      {!session.agentPersonaId && <OnboardingBanner />}

      <div className={`card ${styles.chatCard}`}>
        {access.allowed ? <ChatWindow /> : <SubscriptionRequiredNotice reason={access.reason} />}
      </div>
    </AppShell>
  );
}
