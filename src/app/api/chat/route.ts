// T-022 — AI 에이전트 대화 Route Handler (AC-008). 얇은 어댑터로만 두고 실제
// 로직(프롬프트 조립, LLM 호출, 폴백 처리)은 agent-conversation-service(Logic)에
// 있다(TRD 4장 결정). LLM 자체 실패는 서비스가 이미 폴백 메시지로 흡수하므로,
// 여기서 잡는 에러는 대화 자체를 찾지 못하는 등 요청 형식 문제뿐이다.
import { NextResponse } from "next/server.js";
import { getSession } from "@/app/_lib/session";
import * as agentConversationService from "@/services/agent-conversation-service";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
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
