// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBanner } from "@/components/ErrorBanner";

describe("ErrorBanner", () => {
  it("메시지를 표시한다", () => {
    render(<ErrorBanner message="문제가 발생했어요" />);
    expect(screen.getByRole("alert")).toHaveTextContent("문제가 발생했어요");
  });

  it("onRetry가 없으면 버튼을 렌더링하지 않는다", () => {
    render(<ErrorBanner message="문제가 발생했어요" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("재시도 버튼 클릭 시 onRetry가 호출된다", () => {
    const onRetry = vi.fn();
    render(<ErrorBanner message="문제가 발생했어요" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
