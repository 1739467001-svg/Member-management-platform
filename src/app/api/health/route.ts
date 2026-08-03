import { NextResponse } from "next/server";
import { accessSync, constants, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const dynamic = "force-dynamic";

/**
 * 部署自检端点。刻意不需要登录 —— 登录本身挂掉的时候才最需要它。
 * 只返回排障必需的信息，不含密码、密钥或业务数据。
 */
export async function GET() {
  const dbPath = resolve(process.env.DATABASE_PATH || "./data/app.db");
  const dir = dirname(dbPath);

  const checks: Record<string, unknown> = {
    dbPath,
    dbPathIsAbsolute: dbPath === resolve(dbPath),
    cwd: process.cwd(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    tz: process.env.TZ || "(未设置)",
    authSecretSet: Boolean(process.env.AUTH_SECRET),
    nodeEnv: process.env.NODE_ENV,
  };

  // 目录能否创建 / 是否可写
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    checks.dataDirWritable = true;
  } catch (error) {
    checks.dataDirWritable = false;
    checks.dataDirError = (error as NodeJS.ErrnoException)?.code ?? String(error);
  }

  // 原生模块能否加载（架构不匹配会在这里暴露）
  try {
    const { default: Database } = await import("better-sqlite3");
    checks.nativeModuleLoaded = true;

    // 真正开一次库并写一次，确认端到端可用
    try {
      const db = new Database(dbPath);
      db.exec("CREATE TABLE IF NOT EXISTS _health (id INTEGER PRIMARY KEY)");
      db.exec("DROP TABLE IF EXISTS _health");
      const size = statSync(dbPath).size;
      db.close();
      checks.databaseWritable = true;
      checks.databaseSizeBytes = size;
    } catch (error) {
      checks.databaseWritable = false;
      checks.databaseError =
        (error as NodeJS.ErrnoException)?.code ?? String(error).slice(0, 200);
    }
  } catch (error) {
    checks.nativeModuleLoaded = false;
    checks.nativeModuleError = String(error).slice(0, 300);
  }

  const ok = checks.dataDirWritable === true && checks.databaseWritable === true;

  return NextResponse.json(
    {
      ok,
      summary: ok
        ? "一切正常，数据库可读写"
        : "数据库不可用 —— 见下方 dataDirError / databaseError / nativeModuleError",
      checks,
    },
    { status: ok ? 200 : 503 },
  );
}
