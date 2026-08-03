import "server-only";
import { randomUUID } from "node:crypto";
import { getSql, ready } from "../db";
import {
  ALERT_THRESHOLD_DAYS,
  WARN_THRESHOLD_DAYS,
  type OrderStatus,
  type CustomerTier,
} from "../constants";
import { computeEndDate, daysRemaining, today } from "../date";
import type { OrderView } from "./types";
import { recomputeCustomers } from "./customers";

/** 剩余天数 → 状态。派生值，不落库，所以跨零点后自动生效 */
export function statusOf(daysLeft: number): OrderStatus {
  if (daysLeft < 0) return "expired";
  if (daysLeft <= ALERT_THRESHOLD_DAYS) return "expiring";
  if (daysLeft <= WARN_THRESHOLD_DAYS) return "expiring_soon";
  return "active";
}

type RawOrderRow = Omit<OrderView, "status" | "daysLeft">;

function decorate(row: RawOrderRow): OrderView {
  const daysLeft = daysRemaining(row.endDate);
  return { ...row, daysLeft, status: statusOf(daysLeft) };
}

export type OrderFilters = {
  status?: OrderStatus | "all";
  platformId?: string;
  accountId?: string;
  customerId?: string;
  search?: string;
  limit?: number;
};

export async function listOrders(filters: OrderFilters = {}): Promise<OrderView[]> {
  await ready();
  const pg = getSql();
  const like = filters.search ? `%${filters.search}%` : null;

  // postgres.js 不方便拼动态 WHERE，用「参数为 NULL 即跳过该条件」的写法，
  // 既避免字符串拼接，也保持单条语句
  const rows = await pg<RawOrderRow[]>`
    SELECT o.id, o.customer_id AS "customerId", c.name AS "customerName",
           c.tier AS "customerTier", c.score AS "customerScore",
           o.platform_id AS "platformId", p.name AS "platformName",
           p.color_slot AS "colorSlot",
           o.account_id AS "accountId", a.label AS "accountLabel",
           o.price, o.suggested_price AS "suggestedPrice",
           o.start_date AS "startDate", o.end_date AS "endDate",
           o.duration_days AS "durationDays", o.duration_type AS "durationType",
           o.customer_type AS "customerType", o.device, o.region, o.note,
           o.renewed_from_id AS "renewedFromId"
    FROM rental_order o
    JOIN customer c ON c.id = o.customer_id
    JOIN platform p ON p.id = o.platform_id
    LEFT JOIN account a ON a.id = o.account_id
    WHERE (${filters.platformId ?? null}::text IS NULL OR o.platform_id = ${filters.platformId ?? null})
      AND (${filters.accountId ?? null}::text IS NULL OR o.account_id = ${filters.accountId ?? null})
      AND (${filters.customerId ?? null}::text IS NULL OR o.customer_id = ${filters.customerId ?? null})
      AND (${like}::text IS NULL OR c.name LIKE ${like} OR o.note LIKE ${like}
           OR o.region LIKE ${like} OR o.device LIKE ${like} OR a.label LIKE ${like})
    ORDER BY o.end_date DESC, o.created_at DESC
    ${filters.limit ? pg`LIMIT ${filters.limit}` : pg``}`;

  const views = rows.map(decorate);

  // 状态是派生的，只能在内存里筛
  if (filters.status && filters.status !== "all") {
    return views.filter((o) => o.status === filters.status);
  }
  return views;
}

export async function getOrder(id: string): Promise<OrderView | null> {
  const rows = await listOrders({});
  return rows.find((o) => o.id === id) ?? null;
}

/**
 * 每个「客户 × 平台」只保留到期日最晚的那一单。
 * 续过费的客户，早先那几轮已经被接替，不该再出现在提醒里。
 */
export function currentSubscriptions(orders: OrderView[]): OrderView[] {
  const latest = new Map<string, OrderView>();
  for (const o of orders) {
    const key = `${o.customerId}|${o.platformId}`;
    const prev = latest.get(key);
    if (!prev || o.endDate > prev.endDate) latest.set(key, o);
  }
  return [...latest.values()];
}

/** 到期提醒清单：剩余 ≤ 1 天，含刚过期一周内的（那些同样需要追） */
export async function getExpiringOrders(): Promise<OrderView[]> {
  return currentSubscriptions(await listOrders())
    .filter((o) => o.daysLeft <= ALERT_THRESHOLD_DAYS && o.daysLeft >= -7)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/** 次级预警：2–3 天内到期 */
export async function getWarningOrders(): Promise<OrderView[]> {
  return currentSubscriptions(await listOrders())
    .filter((o) => o.daysLeft > ALERT_THRESHOLD_DAYS && o.daysLeft <= WARN_THRESHOLD_DAYS)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/* ── 新老客判定与建议价 ─────────────────────────────── */

/**
 * 新老客按「该客户在该平台的历史订单数」判定 —— 对应
 * 「第二个月开始降价」的策略：同一平台续到第 2 单即享老客价。
 */
export async function resolveCustomerType(
  customerId: string | null,
  platformId: string,
): Promise<{ type: "new" | "returning"; platformOrders: number; totalOrders: number }> {
  if (!customerId) return { type: "new", platformOrders: 0, totalOrders: 0 };
  await ready();

  const rows = await getSql()<{ total: string; onplatform: string }[]>`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE platform_id = ${platformId}) AS onPlatform
    FROM rental_order WHERE customer_id = ${customerId}`;

  const platformOrders = Number(rows[0]?.onplatform ?? 0);
  return {
    type: platformOrders > 0 ? "returning" : "new",
    platformOrders,
    totalOrders: Number(rows[0]?.total ?? 0),
  };
}

export async function getSuggestedPrice(
  platformId: string,
  customerType: "new" | "returning",
): Promise<number | null> {
  await ready();
  const rows = await getSql()<{ price: number }[]>`
    SELECT price FROM price_rule
    WHERE platform_id = ${platformId} AND customer_type = ${customerType}`;
  return rows[0]?.price ?? null;
}

/* ── 客户查找 / 建档 ────────────────────────────────── */

export async function findCustomerByName(name: string) {
  await ready();
  const rows = await getSql()<
    Array<{ id: string; tier: string; score: number; totalRevenue: number; region: string; device: string }>
  >`
    SELECT id, tier, score, total_revenue AS "totalRevenue", region, device
    FROM customer WHERE name = ${name.trim()} LIMIT 1`;
  return rows[0] ?? null;
}

export async function ensureCustomer(input: {
  name: string;
  region?: string;
  device?: string;
  note?: string;
  customerId?: string | null;
}): Promise<string> {
  await ready();
  const pg = getSql();
  const now = Date.now();

  if (input.customerId) {
    await pg`
      UPDATE customer SET
        region = COALESCE(NULLIF(${input.region ?? ""}, ''), region),
        device = COALESCE(NULLIF(${input.device ?? ""}, ''), device),
        updated_at = ${now}
      WHERE id = ${input.customerId}`;
    return input.customerId;
  }

  const existing = await findCustomerByName(input.name);
  if (existing) {
    await pg`
      UPDATE customer SET
        region = COALESCE(NULLIF(${input.region ?? ""}, ''), region),
        device = COALESCE(NULLIF(${input.device ?? ""}, ''), device),
        updated_at = ${now}
      WHERE id = ${existing.id}`;
    return existing.id;
  }

  const id = randomUUID();
  await pg`
    INSERT INTO customer (id, name, note, region, device, total_orders, total_revenue,
      renewal_count, platform_count, score, tier, tags, created_at, updated_at)
    VALUES (${id}, ${input.name.trim()}, ${input.note ?? ""}, ${input.region ?? ""},
      ${input.device ?? ""}, 0, 0, 0, 0, 0, ${"new" as CustomerTier}, '', ${now}, ${now})`;
  return id;
}

/* ── 写入 ───────────────────────────────────────────── */

export type CreateOrderInput = {
  customerName: string;
  customerId?: string | null;
  platformId: string;
  accountId?: string | null;
  price: number;
  startDate: string;
  durationDays: number;
  durationType?: string;
  customerType?: "new" | "returning" | null;
  device?: string;
  region?: string;
  note?: string;
  renewedFromId?: string | null;
  rawText?: string;
};

export async function createOrder(input: CreateOrderInput): Promise<string> {
  await ready();
  const now = Date.now();

  const customerId = await ensureCustomer({
    name: input.customerName,
    customerId: input.customerId,
    region: input.region,
    device: input.device,
  });

  // 文本里没写身份时按历史记录自动判定
  const resolved = await resolveCustomerType(customerId, input.platformId);
  const customerType = input.customerType ?? resolved.type;
  const suggested = await getSuggestedPrice(input.platformId, customerType);

  const id = randomUUID();
  await getSql()`
    INSERT INTO rental_order (id, customer_id, platform_id, account_id, price,
      start_date, duration_days, end_date, duration_type, customer_type,
      device, region, note, suggested_price, renewed_from_id, raw_text,
      created_at, updated_at)
    VALUES (${id}, ${customerId}, ${input.platformId}, ${input.accountId ?? null},
      ${input.price}, ${input.startDate}, ${input.durationDays},
      ${computeEndDate(input.startDate, input.durationDays)},
      ${input.durationType ?? "month"}, ${customerType}, ${input.device ?? ""},
      ${input.region ?? ""}, ${input.note ?? ""}, ${suggested},
      ${input.renewedFromId ?? null}, ${input.rawText ?? ""}, ${now}, ${now})`;

  await recomputeCustomers();
  return id;
}

export async function updateOrder(
  id: string,
  patch: Partial<{
    price: number;
    startDate: string;
    durationDays: number;
    device: string;
    region: string;
    note: string;
    accountId: string | null;
  }>,
): Promise<void> {
  await ready();
  const pg = getSql();

  const current = await pg<{ startDate: string; durationDays: number }[]>`
    SELECT start_date AS "startDate", duration_days AS "durationDays"
    FROM rental_order WHERE id = ${id}`;
  if (current.length === 0) return;

  const startDate = patch.startDate ?? current[0].startDate;
  const durationDays = patch.durationDays ?? current[0].durationDays;

  await pg`
    UPDATE rental_order SET
      price = COALESCE(${patch.price ?? null}, price),
      start_date = ${startDate},
      duration_days = ${durationDays},
      end_date = ${computeEndDate(startDate, durationDays)},
      account_id = ${patch.accountId ?? null},
      device = COALESCE(${patch.device ?? null}, device),
      region = COALESCE(${patch.region ?? null}, region),
      note = COALESCE(${patch.note ?? null}, note),
      updated_at = ${Date.now()}
    WHERE id = ${id}`;

  await recomputeCustomers();
}

export async function deleteOrder(id: string): Promise<void> {
  await ready();
  await getSql()`DELETE FROM rental_order WHERE id = ${id}`;
  await recomputeCustomers();
}

/**
 * 一键续费：新订单从原订单到期日接续，价格取老客建议价。
 * 起始日不早于今天——避免为一张过期很久的单补出一段已经过去的有效期。
 */
export async function renewOrder(
  orderId: string,
  overrides: { price?: number } = {},
): Promise<string | null> {
  const prev = await getOrder(orderId);
  if (!prev) return null;

  const start = prev.endDate < today() ? today() : prev.endDate;
  const suggested = await getSuggestedPrice(prev.platformId, "returning");

  return createOrder({
    customerName: prev.customerName,
    customerId: prev.customerId,
    platformId: prev.platformId,
    // 续费默认还用同一个账号，客户不用换登录方式
    accountId: prev.accountId,
    price: overrides.price ?? suggested ?? prev.price,
    startDate: start,
    durationDays: prev.durationDays,
    durationType: prev.durationType,
    customerType: "returning",
    device: prev.device,
    region: prev.region,
    note: prev.note,
    renewedFromId: prev.id,
    rawText: `续费自 ${prev.startDate}`,
  });
}
