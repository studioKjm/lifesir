// T-022 — AI 에이전트 대화 Route Handler (AC-008). 얇은 어댑터로만 두고 실제
// 로직(프롬프트 조립, LLM 호출, 폴백 처리)은 agent-conversation-service(Logic)에
// 있다(TRD 4장 결정). LLM 자체 실패는 서비스가 이미 폴백 메시지로 흡수하므로,
// 여기서 잡는 에러는 대화 자체를 찾지 못하는 등 요청 형식 문제뿐이다.
//
// T-018 (seed-v3, AC-001) — /chat 페이지 게이트를 우회한 직접 API 호출을 막기
// 위해 여기서도 독립적으로 checkAICoachAccess를 재확인한다(defense in depth,
// TRD §16.1) — 페이지가 이미 확인한 결과를 재사용하지 않는다.
import { NextResponse } from "next/server.js";
import { getSession } from "@/app/_lib/session";
import * as agentConversationService from "@/services/agent-conversation-service";
import * as subscriptionService from "@/services/subscription-service";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const access = await subscriptionService.checkAICoachAccess(session.id);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : undefined;
  if (!content) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  try {
    const message = await agentConversationService.sendMessage(session.id, { conversationId, content });
    return NextResponse.json({ message });
  } catch (err) {
    if (err instanceof agentConversationService.ConversationError) {
      return NextResponse.json({ error: err.code }, { status: 409 });
    }
    throw err;
  }
}
