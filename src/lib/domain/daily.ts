import "server-only";
import { getSql, ready } from "../db";
import { today } from "../date";
import { recomputeCustomers } from "./customers";
import { getExpiringOrders, listOrders } from "./orders";
import { platformStats } from "./reports";
import { getSetting, setSetting } from "./settings";

/**
 * 每日任务。注意：订单的剩余天数是查询时实时算的，不依赖这里跑成功，
 * 所以即使某天没执行，页面数据依然准确 —— 这里只做重算与快照。
 *
 * 数据库备份不在这里做：托管 Postgres（Neon / Supabase 等）自带按时间点恢复，
 * 而无服务器环境也没有可写磁盘可以落备份文件。
 */
export async function runDailyTasks(): Promise<{
  date: string;
  activeOrders: number;
  expiring: number;
}> {
  await ready();
  const date = today();

  await recomputeCustomers();

  const [orders, expiring, stats] = await Promise.all([
    listOrders(),
    getExpiringOrders(),
    platformStats(date, date),
  ]);

  const active = orders.filter((o) => o.status !== "expired");
  const revenue = stats.reduce((s, p) => s + p.revenue, 0);
  const cost = stats.reduce((s, p) => s + p.cost, 0);

  await getSql()`
    INSERT INTO daily_snapshot (date, active_orders, revenue, cost, payload, created_at)
    VALUES (${date}, ${active.length}, ${revenue}, ${cost}, ${JSON.stringify(stats)}, ${Date.now()})
    ON CONFLICT (date) DO UPDATE SET
      active_orders = EXCLUDED.active_orders,
      revenue = EXCLUDED.revenue,
      cost = EXCLUDED.cost,
      payload = EXCLUDED.payload`;

  await setSetting("lastDailyRun", date);

  return { date, activeOrders: active.length, expiring: expiring.length };
}

/** 今天是否已经跑过 */
export async function hasRunToday(): Promise<boolean> {
  return (await getSetting("lastDailyRun")) === today();
}

/**
 * 若今天还没跑过就补跑一次。
 *
 * 整段都包在 try 里：读设置本身也要访问数据库，连接没配好时它会先抛错。
 * 这是个后台维护任务，绝不该因为它失败就让整个应用起不来 ——
 * 尤其不能连带把 /api/health 这种排障入口也弄挂。
 */
export async function ensureDailyRun(): Promise<void> {
  try {
    if (await hasRunToday()) return;
    await runDailyTasks();
  } catch (error) {
    console.error("[daily] 每日任务跳过（数据库不可用或执行失败）:", error);
  }
}
