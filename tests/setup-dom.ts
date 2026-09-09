// 컴포넌트 테스트(@vitest-environment jsdom)에서만 의미 있는 matcher 확장/정리.
// node 환경 테스트에서는 조용히 no-op.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
