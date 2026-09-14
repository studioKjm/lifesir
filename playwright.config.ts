import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  // 2026-09-13(/evaluate): 이 스위트가 커지면서(seed-v2) 기본 워커 수(CPU 코어 수,
  // 이 머신에서 4)로 돌리면 로컬 Supabase Docker 스택(단일 Postgres/GoTrue
  // 컨테이너)에 signup/signin 요청이 동시에 몰려 간헐적으로 실패했다 —
  // --workers=1로는 100% 통과, 기본값(4)으로는 재현 가능하게 실패해 리소스
  // 경합으로 확인했다(코드 버그 아님). 로컬 Supabase가 병목이라 워커 수를
  // 낮추는 것으로 해결한다 — 병렬 자체를 끄면(2 미만) 스위트가 필요 이상 느려진다.
  workers: 2,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
