import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@openai/codex", "@openai/codex-sdk"],
};

export default nextConfig;
