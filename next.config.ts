import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 自托管：产出可独立运行的 server.js，无需在服务器上装 node_modules
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  typescript: { ignoreBuildErrors: false },

  // 数据库路径来自环境变量，打包器无法静态分析这些 fs 调用，
  // 会把整个项目目录（含源码、文档、开发用的 .db）拖进 standalone 产物。
  // 这里显式排除——运行期真正需要的只有 .next 与 node_modules。
  outputFileTracingExcludes: {
    "*": [
      "./src/**",
      "./docs/**",
      "./data/**",
      "./backup/**",
      "./.git/**",
      "./package-lock.json",
      "./tsconfig.tsbuildinfo",
      "./node_modules/.cache/**",
      "./node_modules/typescript/**",
      "./node_modules/@types/**",
      "./node_modules/tailwindcss/**",
      "./node_modules/@tailwindcss/**",
    ],
  },
};

export default nextConfig;
