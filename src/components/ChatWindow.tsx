"use client";

// T-022 — AI 에이전트 대화 UI (AC-008, AC-009). LLM 클라이언트(src/lib/llm)는
// generateText 기반(비스트리밍)이라, 토큰 단위 스트리밍 대신 "작성 중" 상태 →
// 완성된 응답 표시 방식으로 구현했다 — 실제로 스트리밍하지 않는 응답을 스트리밍
// 하는 것처럼 보이게 흉내 내지 않는다.
import { useId, useRef, useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import styles from "./ChatWindow.module.css";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export function ChatWindow() {
  const inputId = useId();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversationIdRef = useRef<string | undefined>(undefined);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const content = input.trim();
    if (!content || pending) return;

    setError(null);
    setInput("");
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content }]);
    setPending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conversationIdRef.current, content }),
      });
      if (!res.ok) throw new Error(`요청 실패 (status=${res.status})`);

      const { message } = await res.json();
      conversationIdRef.current = message.conversationId;
      setMessages((prev) => [...prev, { id: message.id, role: "assistant", content: message.content }]);
    } catch {
      setError("잠시 응답할 수 없어요. 다시 시도해주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.window}>
      <div className={styles.messages}>
        {messages.length === 0 && !pending ? (
          <p className={styles.empty}>AI 코치에게 오늘 컨디션이나 궁금한 점을 물어보세요.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`${styles.bubbleRow} ${m.role === "user" ? styles.bubbleRowUser : ""}`}>
              <div className={`${styles.bubble} ${m.role === "user" ? styles.bubbleUser : styles.bubbleAssistant}`}>
                {m.content}
              </div>
            </div>
          ))
        )}
        {pending && (
          <div className={styles.bubbleRow}>
            <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>AI가 답변을 작성하고 있어요…</div>
          </div>
        )}
      </div>

      {error && <ErrorBanner message={error} onRetry={() => setError(null)} />}

      <form className={styles.composer} onSubmit={handleSubmit}>
        <label htmlFor={inputId} style={{ display: "none" }}>
          메시지
        </label>
        <input
          id={inputId}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="메시지를 입력하세요"
          disabled={pending}
        />
        <button type="submit" className="btn btn--primary" disabled={pending || !input.trim()}>
          보내기
        </button>
      </form>
    </div>
  );
}
