// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "@/components/EmptyState";

describe("EmptyState", () => {
  it.each(["empty", "forbidden", "llm-error"] as const)("variant=%s 렌더링", (variant) => {
    render(<EmptyState variant={variant} />);
    expect(screen.getByRole("status")).toHaveAttribute("data-variant", variant);
  });

  it("커스텀 description을 우선 표시한다", () => {
    render(<EmptyState variant="empty" description="커스텀 메시지" />);
    expect(screen.getByText("커스텀 메시지")).toBeInTheDocument();
  });
});
