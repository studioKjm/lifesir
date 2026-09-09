import { describe, expect, it, vi } from "vitest";
import { generateText } from "ai";
import { generateReply, LLMError } from "@/lib/llm/llm-client";

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));
vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn((model: string) => ({ model })),
}));

describe("generateReply", () => {
  it("정상 응답을 그대로 반환한다", async () => {
    vi.mocked(generateText).mockResolvedValue({ text: "안녕하세요" } as never);

    const reply = await generateReply("system prompt", [{ role: "user", content: "hi" }]);

    expect(reply).toBe("안녕하세요");
  });

  it("호출 실패 시 LLMError로 변환한다", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("network down"));

    await expect(generateReply("system prompt", [{ role: "user", content: "hi" }])).rejects.toThrow(LLMError);
  });
});
