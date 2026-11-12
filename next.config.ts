import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  // Page payloads stay fresh; the bot owns the bounded display-config cache.
  // The caption assistant may carry downscaled campaign pictures, which the
  // default 1 MB action body cannot hold; caption-ai caps them well below this.
  experimental: { staleTimes: { dynamic: 0, static: 0 }, serverActions: { bodySizeLimit: "4mb" } },
};

export default nextConfig;
