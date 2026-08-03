import "server-only";
import { getSql, ready } from "../db";
import {
  CHURNED_DAYS,
  CHURN_RISK_DAYS,
  PLATFORM_IDS,
  PUNCTUAL_GRACE_DAYS,
  SCORE_WEIGHTS,
  TIER_META,
  type CustomerTier,
} from "../constants";
import { diffDays, today } from "../date";
import type { CustomerView } from "./types";

type OrderRow = {
  customerId: string;
  platformId: string;
  price: number;
  startDate: string;
  endDate: string;
  durationDays: number;
};

type Metrics = {
  totalOrders: number;
  totalRevenue: number;
  renewalCount: number;
  platformCount: number;
  punctualRate: number;
  coveredDays: number;
  daysSinceFirst: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  lastEndDate: string | null;
};

function computeMetrics(orders: OrderRow[]): Metrics {
  const sorted = [...orders].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const byPlatform = new Map<string, OrderRow[]>();
  for (const o of sorted) {
    const list = byPlatform.get(o.platformId) ?? [];
    list.push(o);
    byPlatform.set(o.platformId, list);
  }

  let renewalCount = 0;
  let punctualCount = 0;

  for (const list of byPlatform.values()) {
    // 每个平台的第一单是获客，之后每一单都算续费
    for (let i = 1; i < list.length; i++) {
      renewalCount++;
      // 上一单到期后 3 天内接上，算「按时续费」
      const gap = diffDays(list[i - 1].endDate, list[i].startDate);
      if (gap <= PUNCTUAL_GRACE_DAYS) punctualCount++;
    }
  }

  const firstOrderAt = sorted[0]?.startDate ?? null;
  const lastOrderAt = sorted[sorted.length - 1]?.startDate ?? null;
  const lastEndDate = sorted.reduce<string | null>(
    (max, o) => (max === null || o.endDate > max ? o.endDate : max),
    null,
  );

  return {
    totalOrders: sorted.length,
    totalRevenue: sorted.reduce((sum, o) => sum + o.price, 0),
    renewalCount,
    platformCount: byPlatform.size,
    punctualRate: renewalCount > 0 ? punctualCount / renewalCount : 0,
    coveredDays: sorted.reduce((sum, o) => sum + o.durationDays, 0),
    daysSinceFirst: firstOrderAt ? diffDays(firstOrderAt, today()) : 0,
    firstOrderAt,
    lastOrderAt,
    lastEndDate,
  };
}

/**
 * 优质度评分 0–100。
 * 五个维度分别归一到 0–1 后按权重加总，权重见 constants.SCORE_WEIGHTS。
 */
function computeScore(m: Metrics, revenuePercentile: number): number {
  const revenue = revenuePercentile;
  const renewal = Math.min(1, m.renewalCount / 5); // 续 5 次即满分
  // 时长维度要同时看「跟了多久」和「这段时间里有多少天真的在租」，
  // 只看后者会让刚下单的新客拿满分
  const coverage = Math.min(1, m.coveredDays / Math.max(1, m.daysSinceFirst + 1));
  const tenure = Math.min(1, m.daysSinceFirst / 180) * coverage;
  const punctual = m.punctualRate;
  const cross = Math.min(1, m.platformCount / PLATFORM_IDS.length);

  const raw =
    (SCORE_WEIGHTS.revenue * revenue +
      SCORE_WEIGHTS.renewal * renewal +
      SCORE_WEIGHTS.tenure * tenure +
      SCORE_WEIGHTS.punctual * punctual +
      SCORE_WEIGHTS.crossPlatform * cross) /
    100;

  return Math.round(Math.max(0, Math.min(1, raw)) * 100);
}

function computeTier(score: number, m: Metrics): CustomerTier {
  // 首单且未满 30 天的一律算新客——他们还没机会展现忠诚度
  if (m.totalOrders <= 1 && m.daysSinceFirst < 30) return "new";
  if (score >= TIER_META.diamond.min) return "diamond";
  if (score >= TIER_META.gold.min) return "gold";
  if (score >= TIER_META.silver.min) return "silver";
  return "normal";
}

function computeTags(m: Metrics, tier: CustomerTier, isBigSpender: boolean): string[] {
  const tags: string[] = [];
  if (tier === "new") tags.push("新客");
  if (m.totalOrders >= 2) tags.push("老客户");
  if (m.platformCount >= 2) tags.push("跨平台");
  if (m.totalOrders >= 4) tags.push("高频");
  if (isBigSpender) tags.push("大额");

  if (m.lastEndDate) {
    const overdue = diffDays(m.lastEndDate, today());
    if (overdue > CHURNED_DAYS) tags.push("已流失");
    else if (overdue >= CHURN_RISK_DAYS) tags.push("流失风险");
  }
  return tags;
}

/**
 * 重算全部客户的派生指标。
 * 订单发生任何变化后调用；每日任务也会跑一次（因为「距今天数」会随日期漂移）。
 */
export async function recomputeCustomers(): Promise<void> {
  await ready();
  const pg = getSql();

  const rows = await pg<OrderRow[]>`
    SELECT customer_id AS "customerId", platform_id AS "platformId", price,
           start_date AS "startDate", end_date AS "endDate",
           duration_days AS "durationDays"
    FROM rental_order`;

  const grouped = new Map<string, OrderRow[]>();
  for (const r of rows) {
    const list = grouped.get(r.customerId) ?? [];
    list.push(r);
    grouped.set(r.customerId, list);
  }

  const ids = await pg<{ id: string }[]>`SELECT id FROM customer`;

  const metricsById = new Map<string, Metrics>();
  for (const { id } of ids) {
    metricsById.set(id, computeMetrics(grouped.get(id) ?? []));
  }

  // 消费金额的相对分位：跟同期其他客户比，而不是拍一个绝对门槛
  const revenues = [...metricsById.values()]
    .map((m) => m.totalRevenue)
    .sort((a, b) => a - b);
  const percentileOf = (value: number): number => {
    if (revenues.length <= 1) return value > 0 ? 1 : 0;
    const below = revenues.filter((r) => r < value).length;
    return below / (revenues.length - 1);
  };
  const bigSpenderThreshold = revenues[Math.floor(revenues.length * 0.8)] ?? Infinity;

  const now = Date.now();
  for (const [id, m] of metricsById) {
    const score = computeScore(m, percentileOf(m.totalRevenue));
    const tier = computeTier(score, m);
    const tags = computeTags(
      m,
      tier,
      m.totalRevenue > 0 && m.totalRevenue >= bigSpenderThreshold,
    );

    await pg`
      UPDATE customer SET
        total_orders = ${m.totalOrders},
        total_revenue = ${Number(m.totalRevenue.toFixed(2))},
        renewal_count = ${m.renewalCount},
        platform_count = ${m.platformCount},
        first_order_at = ${m.firstOrderAt},
        last_order_at = ${m.lastOrderAt},
        score = ${score},
        tier = ${tier},
        tags = ${tags.join(",")},
        updated_at = ${now}
      WHERE id = ${id}`;
  }
}

/* ── 读取 ───────────────────────────────────────────── */

type CustomerRow = Omit<CustomerView, "tags"> & { tags: string };

function toView(row: CustomerRow): CustomerView {
  return {
    ...row,
    activeOrders: Number(row.activeOrders),
    tags: row.tags ? row.tags.split(",").filter(Boolean) : [],
  };
}

export async function listCustomers(
  opts: { tier?: CustomerTier; search?: string; tag?: string } = {},
): Promise<CustomerView[]> {
  await ready();
  const like = opts.search ? `%${opts.search}%` : null;
  const tagLike = opts.tag ? `%${opts.tag}%` : null;

  const rows = await getSql()<CustomerRow[]>`
    SELECT c.id, c.name, c.note, c.region, c.device,
           c.first_order_at AS "firstOrderAt", c.last_order_at AS "lastOrderAt",
           c.total_orders AS "totalOrders", c.total_revenue AS "totalRevenue",
           c.renewal_count AS "renewalCount", c.platform_count AS "platformCount",
           c.score, c.tier, c.tags,
           (SELECT COUNT(*) FROM rental_order o
             WHERE o.customer_id = c.id AND o.end_date >= ${today()}) AS "activeOrders"
    FROM customer c
    WHERE (${opts.tier ?? null}::text IS NULL OR c.tier = ${opts.tier ?? null})
      AND (${like}::text IS NULL OR c.name LIKE ${like} OR c.note LIKE ${like} OR c.region LIKE ${like})
      AND (${tagLike}::text IS NULL OR c.tags LIKE ${tagLike})
    ORDER BY c.score DESC, c.total_revenue DESC`;

  return rows.map(toView);
}

export async function getCustomer(id: string): Promise<CustomerView | null> {
  await ready();
  const rows = await getSql()<CustomerRow[]>`
    SELECT c.id, c.name, c.note, c.region, c.device,
           c.first_order_at AS "firstOrderAt", c.last_order_at AS "lastOrderAt",
           c.total_orders AS "totalOrders", c.total_revenue AS "totalRevenue",
           c.renewal_count AS "renewalCount", c.platform_count AS "platformCount",
           c.score, c.tier, c.tags,
           (SELECT COUNT(*) FROM rental_order o
             WHERE o.customer_id = c.id AND o.end_date >= ${today()}) AS "activeOrders"
    FROM customer c WHERE c.id = ${id}`;
  return rows[0] ? toView(rows[0]) : null;
}

/** 优质客户：按分数排序 */
export async function getTopCustomers(limit = 5): Promise<CustomerView[]> {
  const all = await listCustomers();
  return all.filter((c) => c.totalOrders > 0).slice(0, limit);
}

export async function updateCustomerNote(id: string, note: string): Promise<void> {
  await ready();
  await getSql()`
    UPDATE customer SET note = ${note}, updated_at = ${Date.now()} WHERE id = ${id}`;
}
