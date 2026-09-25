import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  // 2026-09-18 — 이 머신의 /etc/hosts에 표준 "127.0.0.1 localhost" 항목이 빠져
  // 있어(원인 불명, 이 세션에서 처음 발견 — repo 문제 아님) Vite 내부 서버가
  // 기본 host "localhost"를 DNS로 해석하려다 ENOTFOUND로 즉시 죽는다. 실제
  // IP 리터럴로 명시하면 DNS 조회 자체를 건너뛰어 이 머신 환경 문제와 무관하게
  // 안정적으로 동작한다 — 테스트 동작 자체를 바꾸지 않는 순수 환경 방어.
  server: { host: "127.0.0.1" },
  test: {
    pool: "threads",
    environment: "node",
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup-env.ts", "tests/setup-dom.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
