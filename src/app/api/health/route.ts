import { NextResponse } from "next/server";
import { getSql, ready } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * 部署自检端点。刻意不需要登录 —— 登录本身挂掉的时候才最需要它。
 * 只返回排障必需的信息，不含密码、密钥或业务数据（连接串只回显主机名）。
 */
export async function GET() {
  const rawUrl =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.DATABASE_POSTGRES_URL;

  const checks: Record<string, unknown> = {
    databaseUrlSet: Boolean(rawUrl),
    databaseHost: rawUrl ? safeHost(rawUrl) : null,
    authSecretSet: Boolean(process.env.AUTH_SECRET),
    cronSecretSet: Boolean(process.env.CRON_SECRET || process.env.CRON_TOKEN),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    tz: process.env.TZ || "(未设置，将按 UTC 计算日期)",
    vercel: Boolean(process.env.VERCEL),
    region: process.env.VERCEL_REGION ?? null,
  };

  if (!rawUrl) {
    return NextResponse.json(
      {
        ok: false,
        summary:
          "没有配置 DATABASE_URL。请在 Vercel 项目里创建 Postgres（Storage → Create Database → Neon），它会自动注入连接串；然后 Redeploy 一次。",
        checks,
      },
      { status: 503 },
    );
  }

  try {
    await ready(); // 建表 + 预置数据
    const rows = await getSql()<Array<{ version: string; now: string }>>`
      SELECT version() AS version, now()::text AS now`;
    const counts = await getSql()<Array<{ orders: string; customers: string }>>`
      SELECT (SELECT COUNT(*) FROM rental_order) AS orders,
             (SELECT COUNT(*) FROM customer) AS customers`;

    checks.databaseReachable = true;
    checks.serverVersion = rows[0]?.version?.split(" ").slice(0, 2).join(" ");
    checks.serverTime = rows[0]?.now;
    checks.orders = Number(counts[0]?.orders ?? 0);
    checks.customers = Number(counts[0]?.customers ?? 0);

    return NextResponse.json({ ok: true, summary: "一切正常，数据库可读写", checks });
  } catch (error) {
    checks.databaseReachable = false;
    checks.databaseError =
      error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);

    return NextResponse.json(
      {
        ok: false,
        summary: "连不上数据库 —— 见 databaseError",
        checks,
      },
      { status: 503 },
    );
  }
}

/** 只回显主机名，绝不回显用户名密码 */
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(连接串格式无法解析)";
  }
}
