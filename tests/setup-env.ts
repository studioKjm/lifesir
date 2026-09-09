// vitest setupFiles — .env.local을 로드한다 (통합 테스트가 로컬 Supabase에 접속할 때 필요).
// 단위 테스트는 레포지토리를 mock하므로 이 값들을 쓰지 않는다.
import { config } from "dotenv";
import path from "node:path";

config({ path: path.resolve(__dirname, "../.env.local") });
