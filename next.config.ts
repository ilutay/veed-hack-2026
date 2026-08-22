import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/taste-labs/run/**": ["./codex/examples/fixture-run/**/*"],
  },
  serverExternalPackages: ["@openai/codex", "@openai/codex-sdk"],
};

export default nextConfig;
