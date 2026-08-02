/**
 * Next.js 的 standalone 产物不含静态资源——官方要求手动把 .next/static 与 public
 * 拷进去，否则页面能打开但样式和 JS 全是 404。
 * 挂到 npm run build 之后，保证 `npm run build` 直接产出可运行的完整产物。
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");

if (!existsSync(standalone)) {
  console.log("[postbuild] 未找到 standalone 产物，跳过（output 未设为 standalone？）");
  process.exit(0);
}

const staticSrc = join(root, ".next", "static");
const staticDest = join(standalone, ".next", "static");
if (existsSync(staticSrc)) {
  mkdirSync(join(standalone, ".next"), { recursive: true });
  cpSync(staticSrc, staticDest, { recursive: true });
  console.log("[postbuild] 已复制 .next/static");
}

const publicSrc = join(root, "public");
if (existsSync(publicSrc)) {
  cpSync(publicSrc, join(standalone, "public"), { recursive: true });
  console.log("[postbuild] 已复制 public");
}

console.log("[postbuild] standalone 产物已就绪：node .next/standalone/server.js");
