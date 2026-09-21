import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@pump-fun/pump-sdk", "@raydium-io/raydium-sdk-v2"],
};

export default nextConfig;
