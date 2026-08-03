import "server-only";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { sqlite } from "../db";
import { today } from "../date";
import { recomputeCustomers } from "./customers";
import { getExpiringOrders, listOrders } from "./orders";
import { platformStats } from "./reports";
import { getSetting, setSetting } from "./settings";

const BACKUP_KEEP = 30;

/**
 * 每日任务。注意：订单的剩余天数是查询时实时算的，不依赖这里跑成功，
 * 所以即使某天没执行，页面数据依然准确——这里只做重算、快照和备份。
 */
export async function runDailyTasks(): Promise<{
  date: string;
  activeOrders: number;
  expiring: number;
  backedUp: boolean;
}> {
  const date = today();

  recomputeCustomers();

  const orders = listOrders();
  const active = orders.filter((o) => o.status !== "expired");
  const expiring = getExpiringOrders();

  const stats = platformStats(date, date);
  const revenue = stats.reduce((s, p) => s + p.revenue, 0);
  const cost = stats.reduce((s, p) => s + p.cost, 0);

  sqlite
    .prepare(
      `INSERT INTO daily_snapshot (date, active_orders, revenue, cost, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         active_orders = excluded.active_orders,
         revenue = excluded.revenue,
         cost = excluded.cost,
         payload = excluded.payload`,
    )
    .run(date, active.length, revenue, cost, JSON.stringify(stats), Date.now());

  const backedUp = await backupDatabase();
  setSetting("lastDailyRun", date);

  return { date, activeOrders: active.length, expiring: expiring.length, backedUp };
}

/** 备份就是复制一份 .db 文件；用 SQLite 的在线备份 API 保证一致性 */
async function backupDatabase(): Promise<boolean> {
  try {
    const dir = resolve(process.env.BACKUP_PATH || "./backup");
    mkdirSync(dir, { recursive: true });

    const target = join(dir, `app-${today()}.db`);
    if (existsSync(target)) return true;

    await sqlite.backup(target);

    const files = readdirSync(dir)
      .filter((f) => f.startsWith("app-") && f.endsWith(".db"))
      .map((f) => ({ name: f, time: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    for (const stale of files.slice(BACKUP_KEEP)) {
      unlinkSync(join(dir, stale.name));
    }
    return true;
  } catch (error) {
    console.error("[daily] 数据库备份失败:", error);
    return false;
  }
}

/** 今天是否已经跑过 */
export function hasRunToday(): boolean {
  return getSetting("lastDailyRun") === today();
}

/**
 * 若今天还没跑过就补跑一次（应用启动时与访问看板时调用）。
 *
 * 整段都包在 try 里：hasRunToday() 也要读数据库，存储没配好时它会先抛错。
 * 这是个后台维护任务，绝不该因为它失败就让整个应用起不来 ——
 * 尤其不能连带把 /api/health 这种排障入口也弄挂。
 */
export async function ensureDailyRun(): Promise<void> {
  try {
    if (hasRunToday()) return;
    await runDailyTasks();
  } catch (error) {
    console.error("[daily] 每日任务跳过（数据库不可用或执行失败）:", error);
  }
}
