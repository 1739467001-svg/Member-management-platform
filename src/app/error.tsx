"use client";

import { useEffect } from "react";

/**
 * 出错时给出能直接照做的信息，而不是一句「服务器错误」。
 * 自托管场景下最常见的就是数据库路径不可写 / 原生模块架构不匹配，
 * 这两类问题不告诉用户具体是什么，根本无从下手。
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[page error]", error);
  }, [error]);

  const isDbError = error.message.includes("数据库初始化失败");

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-lg">
        <div className="card-surface p-6">
          <div className="mb-4 flex items-start gap-3">
            <span aria-hidden className="text-xl text-critical">
              ⬤
            </span>
            <div>
              <h1 className="text-base font-semibold text-ink">
                {isDbError ? "数据库无法初始化" : "页面加载失败"}
              </h1>
              <p className="mt-1 text-xs text-ink-2">
                {isDbError
                  ? "应用起来了，但数据存不下去。多半是部署环境的存储配置问题。"
                  : "服务端出错了。下面是原始信息，可以据此排查。"}
              </p>
            </div>
          </div>

          <pre className="overflow-x-auto rounded-lg bg-sunken p-3 text-[11px] leading-relaxed text-ink-2">
            {error.message}
            {error.digest && `\n\ndigest: ${error.digest}`}
          </pre>

          {isDbError && (
            <div className="mt-3 rounded-lg tint-warning px-3 py-2.5 text-[11px] leading-relaxed text-ink">
              <strong>常见原因：</strong>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                <li>
                  部署在 Vercel / Netlify / 函数计算等<strong>无服务器平台</strong> ——
                  这类平台文件系统只读，本机 SQLite 用不了，需要改用云服务器或网络数据库
                </li>
                <li>
                  Docker 用了 <code>bind mount</code>，宿主目录属主不是容器内用户 ——
                  执行 <code>chown -R 1001:1001 &lt;宿主目录&gt;</code>
                </li>
                <li>
                  <code>DATABASE_PATH</code> 写成了相对路径 —— standalone 部署必须用绝对路径
                </li>
                <li>
                  在 x64 机器构建后拷到 ARM 服务器 —— 需在目标机重新构建
                </li>
              </ul>
              <p className="mt-2">
                访问 <code>/api/health</code> 可以看到数据库路径、可写性与运行架构。
              </p>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={reset}
              className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-ink hover:bg-primary-hover"
            >
              重试
            </button>
            <a
              href="/api/health"
              className="rounded-lg border border-line px-4 py-2 text-xs text-ink-2 hover:bg-sunken"
            >
              查看诊断信息
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
