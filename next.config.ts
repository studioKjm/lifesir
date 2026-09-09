import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright E2E(tests/e2e)가 127.0.0.1:3100에서 dev 서버에 접속하므로 HMR 차단을 풀어준다.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
