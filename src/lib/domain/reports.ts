import "server-only";
import { sqlite } from "../db";
import { CONVERSION_WINDOW_DAYS } from "../constants";
import { addDays, diffDays, periodOf, previousPeriod, recentPeriods, today, type Period } from "../date";
import type { AccountLoadRow, AccountStat, PeriodSummary, PlatformStat } from "./types";
import { currentSubscriptions, getExpiringOrders, listOrders } from "./orders";
import { getTopCustomers } from "./customers";

export type Granularity = "week" | "month" | "year";

/**
 * 收入按订单起始日计入，成本按发生日计入（现金口径）。
 * 一份账号成本可以服务多个租户，所以毛利只在「平台」这一层有意义。
 */
export function platformStats(start: string, end: string): PlatformStat[] {
  const rows = sqlite
    .prepare(
      `SELECT p.id AS platformId, p.name AS platformName, p.color_slot AS colorSlot,
              (SELECT COUNT(*) FROM rental_order o
                 WHERE o.platform_id = p.id AND o.start_date BETWEEN ? AND ?) AS orders,
              (SELECT COALESCE(SUM(o.price), 0) FROM rental_order o
                 WHERE o.platform_id = p.id AND o.start_date BETWEEN ? AND ?) AS revenue,
              (SELECT COALESCE(SUM(r.amount), 0) FROM cost_record r
                 WHERE r.platform_id = p.id AND r.cost_date BETWEEN ? AND ?) AS cost
       FROM platform p
       WHERE p.active = 1
       ORDER BY p.sort_order`,
    )
    .all(start, end, start, end, start, end) as Array<
    Omit<PlatformStat, "profit" | "margin">
  >;

  return rows.map((r) => {
    const profit = r.revenue - r.cost;
    return {
      ...r,
      profit,
      margin: r.revenue > 0 ? profit / r.revenue : 0,
    };
  });
}

/**
 * 账号维度收支。收入来自挂在该账号下的订单，成本来自记到该账号的续费。
 * 没指定账号的记录归到「未指定」一行，避免账不平。
 */
export function accountStats(start: string, end: string): AccountStat[] {
  const rows = sqlite
    .prepare(
      `SELECT a.id AS accountId, a.label, a.active,
              (SELECT COUNT(*) FROM rental_order o
                 WHERE o.account_id = a.id AND o.start_date BETWEEN ? AND ?) AS orders,
              (SELECT COALESCE(SUM(o.price), 0) FROM rental_order o
                 WHERE o.account_id = a.id AND o.start_date BETWEEN ? AND ?) AS revenue,
              (SELECT COALESCE(SUM(r.amount), 0) FROM cost_record r
                 WHERE r.account_id = a.id AND r.cost_date BETWEEN ? AND ?) AS cost
       FROM account a
       ORDER BY a.sort_order`,
    )
    .all(start, end, start, end, start, end) as Array<{
    accountId: string;
    label: string;
    active: number;
    orders: number;
    revenue: number;
    cost: number;
  }>;

  const unassigned = sqlite
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM rental_order o
            WHERE o.account_id IS NULL AND o.start_date BETWEEN ? AND ?) AS orders,
         (SELECT COALESCE(SUM(o.price), 0) FROM rental_order o
            WHERE o.account_id IS NULL AND o.start_date BETWEEN ? AND ?) AS revenue,
         (SELECT COALESCE(SUM(r.amount), 0) FROM cost_record r
            WHERE r.account_id IS NULL AND r.cost_date BETWEEN ? AND ?) AS cost`,
    )
    .get(start, end, start, end, start, end) as {
    orders: number;
    revenue: number;
    cost: number;
  };

  const shape = (
    accountId: string,
    label: string,
    active: boolean,
    orders: number,
    revenue: number,
    cost: number,
  ): AccountStat => ({
    accountId,
    label,
    active,
    orders,
    revenue,
    cost,
    profit: revenue - cost,
    margin: revenue > 0 ? (revenue - cost) / revenue : 0,
  });

  const out = rows.map((r) =>
    shape(r.accountId, r.label, r.active === 1, r.orders, r.revenue, r.cost),
  );

  if (unassigned.orders > 0 || unassigned.cost > 0) {
    out.push(shape("", "未指定账号", true, unassigned.orders, unassigned.revenue, unassigned.cost));
  }
  return out;
}

/**
 * 每个账号当前带着几位租户 —— 回答「这个号还能不能再租」和
 * 「这位客户用的是哪个号」。只算还没过期的订单。
 */
export function accountLoad(): AccountLoadRow[] {
  const rows = sqlite
    .prepare(
      `SELECT a.id AS accountId, a.label, a.active,
              p.id AS platformId, p.name AS platformName, p.color_slot AS colorSlot,
              COUNT(o.id) AS renters
       FROM account a
       LEFT JOIN rental_order o ON o.account_id = a.id AND o.end_date >= ?
       LEFT JOIN platform p ON p.id = o.platform_id
       GROUP BY a.id, p.id
       ORDER BY a.sort_order, p.sort_order`,
    )
    .all(today()) as Array<{
    accountId: string;
    label: string;
    active: number;
    platformId: string | null;
    platformName: string | null;
    colorSlot: number | null;
    renters: number;
  }>;

  const byAccount = new Map<string, AccountLoadRow>();
  for (const r of rows) {
    if (!byAccount.has(r.accountId)) {
      byAccount.set(r.accountId, {
        accountId: r.accountId,
        label: r.label,
        active: r.active === 1,
        byPlatform: [],
        totalRenters: 0,
      });
    }
    const entry = byAccount.get(r.accountId)!;
    if (r.platformId && r.renters > 0) {
      entry.byPlatform.push({
        platformId: r.platformId,
        platformName: r.platformName!,
        colorSlot: r.colorSlot!,
        renters: r.renters,
      });
      entry.totalRenters += r.renters;
    }
  }
  return [...byAccount.values()];
}

function countIn(sql: string, ...params: unknown[]): number {
  const row = sqlite.prepare(sql).get(...params) as { n: number } | undefined;
  return row?.n ?? 0;
}

export function summarize(period: Period): PeriodSummary {
  const platforms = platformStats(period.start, period.end);
  const revenue = platforms.reduce((s, p) => s + p.revenue, 0);
  const cost = platforms.reduce((s, p) => s + p.cost, 0);
  const profit = revenue - cost;

  const orders = countIn(
    `SELECT COUNT(*) AS n FROM rental_order WHERE start_date BETWEEN ? AND ?`,
    period.start,
    period.end,
  );
  const customers = countIn(
    `SELECT COUNT(DISTINCT customer_id) AS n FROM rental_order WHERE start_date BETWEEN ? AND ?`,
    period.start,
    period.end,
  );
  const newCustomers = countIn(
    `SELECT COUNT(*) AS n FROM customer WHERE first_order_at BETWEEN ? AND ?`,
    period.start,
    period.end,
  );
  const renewals = countIn(
    `SELECT COUNT(*) AS n FROM rental_order
      WHERE start_date BETWEEN ? AND ? AND customer_type = 'returning'`,
    period.start,
    period.end,
  );

  return {
    label: period.label,
    start: period.start,
    end: period.end,
    revenue,
    cost,
    profit,
    margin: revenue > 0 ? profit / revenue : 0,
    orders,
    customers,
    newCustomers,
    renewals,
    platforms,
  };
}

export function summaryFor(granularity: Granularity, date = today()): PeriodSummary {
  return summarize(periodOf(granularity, date));
}

export function previousSummary(granularity: Granularity, date = today()): PeriodSummary {
  return summarize(previousPeriod(granularity, periodOf(granularity, date)));
}

/** 趋势序列：最近 n 个周期的收入 / 成本 / 毛利 */
export function trend(
  granularity: Granularity,
  count: number,
  from = today(),
): Array<{ key: string; label: string; revenue: number; cost: number; profit: number }> {
  return recentPeriods(granularity, count, from).map((p) => {
    const s = summarize(p);
    return {
      key: p.key,
      label: granularity === "month" ? p.label.replace(/^\d+年/, "") : p.label,
      revenue: s.revenue,
      cost: s.cost,
      profit: s.profit,
    };
  });
}

/** 各平台在最近 n 个周期的收入，用于堆叠柱状图 */
export function platformTrend(
  granularity: Granularity,
  count: number,
  from = today(),
): {
  periods: string[];
  series: Array<{ platformId: string; platformName: string; colorSlot: number; values: number[] }>;
} {
  const periods = recentPeriods(granularity, count, from);
  const stats = periods.map((p) => platformStats(p.start, p.end));

  const platformIds = stats[0]?.map((s) => s.platformId) ?? [];
  const series = platformIds.map((id, idx) => ({
    platformId: id,
    platformName: stats[0][idx].platformName,
    colorSlot: stats[0][idx].colorSlot,
    values: stats.map((snapshot) => snapshot.find((s) => s.platformId === id)?.revenue ?? 0),
  }));

  return {
    periods: periods.map((p) =>
      granularity === "month" ? p.label.replace(/^\d+年/, "") : p.label,
    ),
    series,
  };
}

/** 首页 KPI */
export function dashboardKpis() {
  const month = summaryFor("month");
  const prevMonth = previousSummary("month");
  const active = listOrders().filter((o) => o.status !== "expired");

  const activeCustomers = new Set(active.map((o) => o.customerId)).size;
  const delta = (now: number, before: number) =>
    before === 0 ? (now > 0 ? 1 : 0) : (now - before) / Math.abs(before);

  return {
    revenue: month.revenue,
    revenueDelta: delta(month.revenue, prevMonth.revenue),
    cost: month.cost,
    costDelta: delta(month.cost, prevMonth.cost),
    profit: month.profit,
    profitDelta: delta(month.profit, prevMonth.profit),
    margin: month.margin,
    activeOrders: active.length,
    activeCustomers,
    expiringCount: getExpiringOrders().length,
    monthLabel: month.label,
  };
}

/** 近 n 天每日收入（按订单起始日），用于趋势折线 */
export function dailyRevenue(days: number): Array<{ date: string; value: number }> {
  const start = addDays(today(), -(days - 1));
  const rows = sqlite
    .prepare(
      `SELECT start_date AS date, COALESCE(SUM(price), 0) AS value
       FROM rental_order WHERE start_date BETWEEN ? AND ?
       GROUP BY start_date`,
    )
    .all(start, today()) as Array<{ date: string; value: number }>;

  const map = new Map(rows.map((r) => [r.date, r.value]));
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(start, i);
    return { date, value: map.get(date) ?? 0 };
  });
}

/* ── 经营洞察 ───────────────────────────────────────── */

/** 新客转化率：满了观察期的首单客户里，有多少产生了第 2 单 */
export function conversionStats() {
  const cutoff = addDays(today(), -CONVERSION_WINDOW_DAYS);
  const row = sqlite
    .prepare(
      `SELECT COUNT(*) AS eligible,
              SUM(CASE WHEN total_orders >= 2 THEN 1 ELSE 0 END) AS converted
       FROM customer
       WHERE first_order_at IS NOT NULL AND first_order_at <= ?`,
    )
    .get(cutoff) as { eligible: number; converted: number | null };

  const eligible = row.eligible ?? 0;
  const converted = row.converted ?? 0;
  return {
    eligible,
    converted,
    rate: eligible > 0 ? converted / eligible : 0,
    windowDays: CONVERSION_WINDOW_DAYS,
  };
}

/** 到期未续：已过期且该客户在该平台没有更晚的订单 */
export function lapsedOrders(limit = 10) {
  return currentSubscriptions()
    .filter((o) => o.status === "expired")
    .sort((a, b) => b.endDate.localeCompare(a.endDate))
    .slice(0, limit);
}

export function insights(period: Period) {
  return {
    conversion: conversionStats(),
    lapsed: lapsedOrders(8),
    topCustomers: getTopCustomers(5),
    periodOrders: listOrders().filter(
      (o) => o.startDate >= period.start && o.startDate <= period.end,
    ),
  };
}

/* ── 导出 ───────────────────────────────────────────── */

const yuan = (n: number) => `¥${n.toFixed(2)}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function reportMarkdown(
  granularity: Granularity,
  summary: PeriodSummary,
  previous: PeriodSummary,
): string {
  const title = granularity === "week" ? "周报" : granularity === "month" ? "月报" : "年报";
  const growth = (now: number, before: number) =>
    before === 0 ? (now > 0 ? "新增" : "—") : `${now >= before ? "+" : ""}${pct((now - before) / Math.abs(before))}`;

  const lines: string[] = [
    `# HHStudio 经营${title} · ${summary.label}`,
    ``,
    `统计区间：${summary.start} ~ ${summary.end}`,
    ``,
    `## 核心指标`,
    ``,
    `| 指标 | 本期 | 上期 | 环比 |`,
    `| --- | --- | --- | --- |`,
    `| 收入 | ${yuan(summary.revenue)} | ${yuan(previous.revenue)} | ${growth(summary.revenue, previous.revenue)} |`,
    `| 成本 | ${yuan(summary.cost)} | ${yuan(previous.cost)} | ${growth(summary.cost, previous.cost)} |`,
    `| 毛利 | ${yuan(summary.profit)} | ${yuan(previous.profit)} | ${growth(summary.profit, previous.profit)} |`,
    `| 毛利率 | ${pct(summary.margin)} | ${pct(previous.margin)} | — |`,
    `| 订单数 | ${summary.orders} | ${previous.orders} | ${growth(summary.orders, previous.orders)} |`,
    `| 活跃客户 | ${summary.customers} | ${previous.customers} | ${growth(summary.customers, previous.customers)} |`,
    `| 新增客户 | ${summary.newCustomers} | ${previous.newCustomers} | ${growth(summary.newCustomers, previous.newCustomers)} |`,
    `| 续费单数 | ${summary.renewals} | ${previous.renewals} | ${growth(summary.renewals, previous.renewals)} |`,
    ``,
    `## 平台明细`,
    ``,
    `| 平台 | 订单数 | 收入 | 成本 | 毛利 | 毛利率 |`,
    `| --- | --- | --- | --- | --- | --- |`,
  ];

  for (const p of summary.platforms) {
    lines.push(
      `| ${p.platformName} | ${p.orders} | ${yuan(p.revenue)} | ${yuan(p.cost)} | ${yuan(p.profit)} | ${pct(p.margin)} |`,
    );
  }
  lines.push(
    `| **合计** | **${summary.orders}** | **${yuan(summary.revenue)}** | **${yuan(summary.cost)}** | **${yuan(summary.profit)}** | **${pct(summary.margin)}** |`,
  );

  const conv = conversionStats();
  lines.push(
    ``,
    `## 经营洞察`,
    ``,
    `- 新客转化率：${pct(conv.rate)}（${conv.converted}/${conv.eligible}，观察窗口 ${conv.windowDays} 天）`,
    `- 续费占比：${summary.orders > 0 ? pct(summary.renewals / summary.orders) : "—"}`,
    `- 单均价：${summary.orders > 0 ? yuan(summary.revenue / summary.orders) : "—"}`,
    ``,
    `> 由 HHStudio 会员管理系统生成于 ${today()}`,
  );

  return lines.join("\n");
}

/** 报表 CSV（平台明细） */
export function reportCsv(summary: PeriodSummary): string {
  const rows = [
    ["平台", "订单数", "收入", "成本", "毛利", "毛利率"],
    ...summary.platforms.map((p) => [
      p.platformName,
      String(p.orders),
      p.revenue.toFixed(2),
      p.cost.toFixed(2),
      p.profit.toFixed(2),
      (p.margin * 100).toFixed(1) + "%",
    ]),
    [
      "合计",
      String(summary.orders),
      summary.revenue.toFixed(2),
      summary.cost.toFixed(2),
      summary.profit.toFixed(2),
      (summary.margin * 100).toFixed(1) + "%",
    ],
  ];
  return "﻿" + rows.map((r) => r.join(",")).join("\n");
}

export { diffDays };
