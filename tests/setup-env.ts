// vitest setupFiles — .env.local을 로드한다 (통합 테스트가 로컬 Supabase에 접속할 때 필요).
// 단위 테스트는 레포지토리를 mock하므로 이 값들을 쓰지 않는다.
import { config } from "dotenv";
import path from "node:path";
import NodeWebSocket from "ws";

config({ path: path.resolve(__dirname, "../.env.local") });

// Node 20(테스트 실행 환경)은 네이티브 WebSocket이 없어 supabase-js 계열
// 클라이언트(서버/브라우저 모두) 생성자가 초기화에 실패한다. 실제 브라우저
// 런타임에는 항상 WebSocket이 있으므로 이건 순수 테스트 환경 문제다 — 개별
// 모듈(src/lib/data/supabase-client.ts)에 흩어 놓는 대신 여기 한 곳에서
// 폴리필한다 (2026-09-13, seed-v2: src/lib/supabase-browser.ts 단독 import 시
// 폴리필이 아직 안 걸려 있어서 발견됨).
if (typeof globalThis.WebSocket === "undefined") {
  // @ts-expect-error - ws는 Node용 WebSocket 폴리필이다
  globalThis.WebSocket = NodeWebSocket;
}
