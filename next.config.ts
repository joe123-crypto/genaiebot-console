import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  // Page payloads stay fresh; the bot owns the bounded display-config cache.
  experimental: { staleTimes: { dynamic: 0, static: 0 } },
};

export default nextConfig;
