import "server-only";
import { randomUUID } from "node:crypto";
import { db, sqlite, costRecords } from "../db";
import { eq } from "drizzle-orm";

export type CostView = {
  id: string;
  platformId: string;
  platformName: string;
  colorSlot: number;
  accountId: string | null;
  accountLabel: string | null;
  amount: number;
  costDate: string;
  periodDays: number;
  category: string;
  note: string;
  createdAt: number;
};

const COST_SELECT = `
  SELECT r.id, r.platform_id AS platformId, p.name AS platformName, p.color_slot AS colorSlot,
         r.account_id AS accountId, a.label AS accountLabel,
         r.amount, r.cost_date AS costDate, r.period_days AS periodDays,
         r.category, r.note, r.created_at AS createdAt
  FROM cost_record r
  JOIN platform p ON p.id = r.platform_id
  LEFT JOIN account a ON a.id = r.account_id
`;

export type CreateCostInput = {
  platformId: string;
  accountId?: string | null;
  amount: number;
  costDate: string;
  periodDays?: number;
  category?: string;
  note?: string;
  rawText?: string;
};

export function createCost(input: CreateCostInput): string {
  const id = randomUUID();
  db.insert(costRecords)
    .values({
      id,
      platformId: input.platformId,
      accountId: input.accountId ?? null,
      amount: input.amount,
      costDate: input.costDate,
      periodDays: input.periodDays ?? 30,
      category: input.category ?? "membership",
      note: input.note ?? "",
      rawText: input.rawText ?? "",
      createdAt: Date.now(),
    })
    .run();
  return id;
}

export function listCosts(
  opts: { platformId?: string; start?: string; end?: string; limit?: number } = {},
): CostView[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (opts.platformId) {
    where.push("r.platform_id = ?");
    params.push(opts.platformId);
  }
  if (opts.start) {
    where.push("r.cost_date >= ?");
    params.push(opts.start);
  }
  if (opts.end) {
    where.push("r.cost_date <= ?");
    params.push(opts.end);
  }

  const sql =
    COST_SELECT +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    " ORDER BY r.cost_date DESC, r.created_at DESC" +
    (opts.limit ? ` LIMIT ${Number(opts.limit)}` : "");

  return sqlite.prepare(sql).all(...params) as CostView[];
}

export function deleteCost(id: string): void {
  db.delete(costRecords).where(eq(costRecords.id, id)).run();
}

/** 平台 × 月份 成本矩阵，一眼看清每个平台每月投入 */
export function costMatrix(year: number): {
  months: string[];
  rows: Array<{ platformId: string; platformName: string; colorSlot: number; values: number[]; total: number }>;
  monthTotals: number[];
  grandTotal: number;
} {
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));

  const rows = sqlite
    .prepare(
      `SELECT p.id AS platformId, p.name AS platformName, p.color_slot AS colorSlot,
              substr(r.cost_date, 6, 2) AS month, SUM(r.amount) AS total
       FROM platform p
       LEFT JOIN cost_record r ON r.platform_id = p.id AND substr(r.cost_date, 1, 4) = ?
       GROUP BY p.id, month
       ORDER BY p.sort_order`,
    )
    .all(String(year)) as Array<{
    platformId: string;
    platformName: string;
    colorSlot: number;
    month: string | null;
    total: number | null;
  }>;

  const byPlatform = new Map<
    string,
    { platformId: string; platformName: string; colorSlot: number; values: number[]; total: number }
  >();

  for (const r of rows) {
    if (!byPlatform.has(r.platformId)) {
      byPlatform.set(r.platformId, {
        platformId: r.platformId,
        platformName: r.platformName,
        colorSlot: r.colorSlot,
        values: new Array(12).fill(0),
        total: 0,
      });
    }
    if (r.month && r.total) {
      const entry = byPlatform.get(r.platformId)!;
      entry.values[Number(r.month) - 1] = r.total;
      entry.total += r.total;
    }
  }

  const result = [...byPlatform.values()];
  const monthTotals = months.map((_, i) =>
    result.reduce((sum, row) => sum + row.values[i], 0),
  );

  return {
    months: months.map((m) => `${Number(m)}月`),
    rows: result,
    monthTotals,
    grandTotal: monthTotals.reduce((a, b) => a + b, 0),
  };
}
