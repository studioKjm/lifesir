// T-002 — LLM 호출 래퍼.
// 지금은 기존 OPENAI_API_KEY로 @ai-sdk/openai를 직접 사용한다 (사용자 결정).
// 추후 Vercel AI Gateway로 전환 시, MODEL 문자열만 "openai/gpt-4o-mini" 형태로
// 바꾸고 openai(...)를 gateway 프로바이더로 교체하면 된다 — 이 파일의 나머지
// 인터페이스(generateReply)는 그대로 유지된다.
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";

export class LLMError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LLMError";
  }
}

const MODEL = "gpt-4o-mini";

export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * LLM에게 응답을 요청한다. 실패 시 항상 LLMError를 던진다 —
 * 호출부(Logic 레이어)가 폴백 메시지로 변환할 책임을 진다.
 */
export async function generateReply(
  systemPrompt: string,
  messages: LLMMessage[]
): Promise<string> {
  try {
    const result = await generateText({
      model: openai(MODEL),
      system: systemPrompt,
      messages,
    });
    return result.text;
  } catch (err) {
    throw new LLMError("LLM 응답 생성에 실패했습니다", { cause: err });
  }
}
