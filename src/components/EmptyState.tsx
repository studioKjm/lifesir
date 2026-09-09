// T-003 — 공용 빈 상태/에러 안내 컴포넌트 (AC-010)
// 신규 사용자(데이터 없음), CareLink 미승인, LLM 실패 등 예외 상황에서
// 각 페이지가 재사용한다.

export type EmptyStateVariant = "empty" | "forbidden" | "llm-error";

const COPY: Record<EmptyStateVariant, { title: string; description: string }> = {
  empty: {
    title: "아직 기록이 없어요",
    description: "첫 건강 기록을 남기면 여기에 표시됩니다.",
  },
  forbidden: {
    title: "아직 연결되지 않았어요",
    description: "상대방이 연결 요청을 수락하면 데이터를 볼 수 있어요.",
  },
  "llm-error": {
    title: "잠시 응답할 수 없어요",
    description: "AI 에이전트 연결에 문제가 생겼어요. 잠시 후 다시 시도해주세요.",
  },
};

export interface EmptyStateProps {
  variant: EmptyStateVariant;
  /** COPY 기본 문구 대신 쓸 커스텀 설명 (선택) */
  description?: string;
}

export function EmptyState({ variant, description }: EmptyStateProps) {
  const copy = COPY[variant];
  return (
    <div role="status" data-variant={variant}>
      <p>{copy.title}</p>
      <p>{description ?? copy.description}</p>
    </div>
  );
}
