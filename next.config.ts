import type { NextConfig } from "next";

/**
 * standalone 产物只有自托管（Docker / 裸机）才需要。
 * Vercel 自己处理打包，设了反而多一份无用产物，所以按环境变量开关。
 */
const selfHosted = process.env.BUILD_STANDALONE === "true";

const nextConfig: NextConfig = {
  ...(selfHosted ? { output: "standalone" as const } : {}),
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
