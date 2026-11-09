import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  // The console renders live operator state; nothing here is safe to cache.
  experimental: { staleTimes: { dynamic: 0, static: 0 } },
};

export default nextConfig;
