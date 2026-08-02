import "server-only";
import { randomUUID } from "node:crypto";
import { sqlite, db, rentalOrders, customers, priceRules } from "../db";
import { eq, and } from "drizzle-orm";
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

const ORDER_SELECT = `
  SELECT o.id, o.customer_id AS customerId, c.name AS customerName,
         c.tier AS customerTier, c.score AS customerScore,
         o.platform_id AS platformId, p.name AS platformName, p.color_slot AS colorSlot,
         o.account_id AS accountId, a.label AS accountLabel,
         o.price, o.suggested_price AS suggestedPrice,
         o.start_date AS startDate, o.end_date AS endDate,
         o.duration_days AS durationDays, o.duration_type AS durationType,
         o.customer_type AS customerType, o.device, o.region, o.note,
         o.renewed_from_id AS renewedFromId, o.created_at AS createdAt
  FROM rental_order o
  JOIN customer c ON c.id = o.customer_id
  JOIN platform p ON p.id = o.platform_id
  LEFT JOIN account a ON a.id = o.account_id
`;

type RawOrderRow = Omit<OrderView, "status" | "daysLeft"> & { createdAt: number };

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

export function listOrders(filters: OrderFilters = {}): OrderView[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.platformId) {
    where.push("o.platform_id = ?");
    params.push(filters.platformId);
  }
  if (filters.accountId) {
    where.push("o.account_id = ?");
    params.push(filters.accountId);
  }
  if (filters.customerId) {
    where.push("o.customer_id = ?");
    params.push(filters.customerId);
  }
  if (filters.search) {
    where.push(
      "(c.name LIKE ? OR o.note LIKE ? OR o.region LIKE ? OR o.device LIKE ? OR a.label LIKE ?)",
    );
    const like = `%${filters.search}%`;
    params.push(like, like, like, like, like);
  }

  const sql =
    ORDER_SELECT +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    " ORDER BY o.end_date DESC, o.created_at DESC" +
    (filters.limit ? ` LIMIT ${Number(filters.limit)}` : "");

  const rows = sqlite.prepare(sql).all(...params) as RawOrderRow[];
  const views = rows.map(decorate);

  // 状态是派生的，只能在内存里筛
  if (filters.status && filters.status !== "all") {
    return views.filter((o) => o.status === filters.status);
  }
  return views;
}

export function getOrder(id: string): OrderView | null {
  const row = sqlite.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id) as
    | RawOrderRow
    | undefined;
  return row ? decorate(row) : null;
}

/**
 * 每个「客户 × 平台」只保留到期日最晚的那一单。
 * 续过费的客户，早先那几轮已经被接替，不该再出现在提醒里。
 */
export function currentSubscriptions(orders: OrderView[] = listOrders()): OrderView[] {
  const latest = new Map<string, OrderView>();
  for (const o of orders) {
    const key = `${o.customerId}|${o.platformId}`;
    const prev = latest.get(key);
    if (!prev || o.endDate > prev.endDate) latest.set(key, o);
  }
  return [...latest.values()];
}

/** 到期提醒清单：剩余 ≤ 1 天，含刚过期一周内的（那些同样需要追） */
export function getExpiringOrders(): OrderView[] {
  return currentSubscriptions()
    .filter((o) => o.daysLeft <= ALERT_THRESHOLD_DAYS && o.daysLeft >= -7)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/** 次级预警：2–3 天内到期 */
export function getWarningOrders(): OrderView[] {
  return currentSubscriptions()
    .filter((o) => o.daysLeft > ALERT_THRESHOLD_DAYS && o.daysLeft <= WARN_THRESHOLD_DAYS)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

export function getActiveOrders(): OrderView[] {
  return listOrders().filter((o) => o.status !== "expired");
}

/* ── 新老客判定与建议价 ─────────────────────────────── */

/**
 * 新老客按「该客户在该平台的历史订单数」判定 —— 对应
 * 「第二个月开始降价」的策略：同一平台续到第 2 单即享老客价。
 */
export function resolveCustomerType(
  customerId: string | null,
  platformId: string,
): { type: "new" | "returning"; platformOrders: number; totalOrders: number } {
  if (!customerId) return { type: "new", platformOrders: 0, totalOrders: 0 };

  const row = sqlite
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN platform_id = ? THEN 1 ELSE 0 END) AS onPlatform
       FROM rental_order WHERE customer_id = ?`,
    )
    .get(platformId, customerId) as { total: number; onPlatform: number | null };

  const platformOrders = row.onPlatform ?? 0;
  return {
    type: platformOrders > 0 ? "returning" : "new",
    platformOrders,
    totalOrders: row.total ?? 0,
  };
}

export function getSuggestedPrice(
  platformId: string,
  customerType: "new" | "returning",
): number | null {
  const rule = db
    .select()
    .from(priceRules)
    .where(and(eq(priceRules.platformId, platformId), eq(priceRules.customerType, customerType)))
    .get();
  return rule?.price ?? null;
}

/* ── 客户查找 / 建档 ────────────────────────────────── */

export function findCustomerByName(name: string) {
  return db.select().from(customers).where(eq(customers.name, name.trim())).get() ?? null;
}

export function ensureCustomer(input: {
  name: string;
  region?: string;
  device?: string;
  note?: string;
  /** 明确指定则用它，否则按姓名匹配已有客户 */
  customerId?: string | null;
}): string {
  const now = Date.now();

  if (input.customerId) {
    const patch: Record<string, unknown> = { updatedAt: now };
    if (input.region) patch.region = input.region;
    if (input.device) patch.device = input.device;
    db.update(customers).set(patch).where(eq(customers.id, input.customerId)).run();
    return input.customerId;
  }

  const existing = findCustomerByName(input.name);
  if (existing) {
    db.update(customers)
      .set({
        region: input.region || existing.region,
        device: input.device || existing.device,
        updatedAt: now,
      })
      .where(eq(customers.id, existing.id))
      .run();
    return existing.id;
  }

  const id = randomUUID();
  db.insert(customers)
    .values({
      id,
      name: input.name.trim(),
      note: input.note ?? "",
      region: input.region ?? "",
      device: input.device ?? "",
      totalOrders: 0,
      totalRevenue: 0,
      renewalCount: 0,
      platformCount: 0,
      score: 0,
      tier: "new" as CustomerTier,
      tags: "",
      createdAt: now,
      updatedAt: now,
    })
    .run();
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

export function createOrder(input: CreateOrderInput): string {
  const now = Date.now();
  const customerId = ensureCustomer({
    name: input.customerName,
    customerId: input.customerId,
    region: input.region,
    device: input.device,
  });

  // 文本里没写身份时按历史记录自动判定
  const resolved = resolveCustomerType(customerId, input.platformId);
  const customerType = input.customerType ?? resolved.type;
  const suggested = getSuggestedPrice(input.platformId, customerType);

  const id = randomUUID();
  db.insert(rentalOrders)
    .values({
      id,
      customerId,
      platformId: input.platformId,
      price: input.price,
      startDate: input.startDate,
      durationDays: input.durationDays,
      endDate: computeEndDate(input.startDate, input.durationDays),
      durationType: input.durationType ?? "month",
      customerType,
      device: input.device ?? "",
      region: input.region ?? "",
      note: input.note ?? "",
      suggestedPrice: suggested,
      renewedFromId: input.renewedFromId ?? null,
      accountId: input.accountId ?? null,
      rawText: input.rawText ?? "",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  recomputeCustomers();
  return id;
}

export function updateOrder(
  id: string,
  patch: Partial<{
    price: number;
    startDate: string;
    durationDays: number;
    platformId: string;
    device: string;
    region: string;
    note: string;
    durationType: string;
    accountId: string | null;
  }>,
): void {
  const current = db.select().from(rentalOrders).where(eq(rentalOrders.id, id)).get();
  if (!current) return;

  const startDate = patch.startDate ?? current.startDate;
  const durationDays = patch.durationDays ?? current.durationDays;

  db.update(rentalOrders)
    .set({
      ...patch,
      startDate,
      durationDays,
      endDate: computeEndDate(startDate, durationDays),
      updatedAt: Date.now(),
    })
    .where(eq(rentalOrders.id, id))
    .run();

  recomputeCustomers();
}

export function deleteOrder(id: string): void {
  db.delete(rentalOrders).where(eq(rentalOrders.id, id)).run();
  recomputeCustomers();
}

/**
 * 一键续费：新订单从原订单到期日接续，价格取老客建议价。
 * 起始日不早于今天——避免为一张过期很久的单补出一段已经过去的有效期。
 */
export function renewOrder(orderId: string, overrides: { price?: number } = {}): string | null {
  const prev = getOrder(orderId);
  if (!prev) return null;

  const start = prev.endDate < today() ? today() : prev.endDate;
  const suggested = getSuggestedPrice(prev.platformId, "returning");

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
