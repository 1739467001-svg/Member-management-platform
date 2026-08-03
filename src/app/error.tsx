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
                  <strong>没配 DATABASE_URL</strong> —— Vercel 上到 Storage →
                  Create Database 建一个 Postgres（选 Neon），它会自动注入连接串，
                  然后 <strong>Redeploy 一次</strong>让新变量生效
                </li>
                <li>
                  连接串复制错了或数据库已暂停 —— Neon 免费版闲置会自动休眠，
                  首次访问需要几秒唤醒，重试一次通常就好
                </li>
                <li>自托管时 Postgres 容器还没起来，或连接串里的主机名不对</li>
              </ul>
              <p className="mt-2">
                访问 <code>/api/health</code> 可以看到连接串是否注入、数据库能否连通。
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
