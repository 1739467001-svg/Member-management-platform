import "server-only";
import { randomUUID } from "node:crypto";
import { getSql, ready } from "../db";

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

export async function createCost(input: CreateCostInput): Promise<string> {
  await ready();
  const id = randomUUID();
  await getSql()`
    INSERT INTO cost_record (id, platform_id, account_id, amount, cost_date,
      period_days, category, note, raw_text, created_at)
    VALUES (${id}, ${input.platformId}, ${input.accountId ?? null}, ${input.amount},
      ${input.costDate}, ${input.periodDays ?? 30}, ${input.category ?? "membership"},
      ${input.note ?? ""}, ${input.rawText ?? ""}, ${Date.now()})`;
  return id;
}

export async function listCosts(
  opts: { platformId?: string; start?: string; end?: string; limit?: number } = {},
): Promise<CostView[]> {
  await ready();
  const pg = getSql();

  return await pg<CostView[]>`
    SELECT r.id, r.platform_id AS "platformId", p.name AS "platformName",
           p.color_slot AS "colorSlot",
           r.account_id AS "accountId", a.label AS "accountLabel",
           r.amount, r.cost_date AS "costDate", r.period_days AS "periodDays",
           r.category, r.note, r.created_at AS "createdAt"
    FROM cost_record r
    JOIN platform p ON p.id = r.platform_id
    LEFT JOIN account a ON a.id = r.account_id
    WHERE (${opts.platformId ?? null}::text IS NULL OR r.platform_id = ${opts.platformId ?? null})
      AND (${opts.start ?? null}::text IS NULL OR r.cost_date >= ${opts.start ?? null})
      AND (${opts.end ?? null}::text IS NULL OR r.cost_date <= ${opts.end ?? null})
    ORDER BY r.cost_date DESC, r.created_at DESC
    ${opts.limit ? pg`LIMIT ${opts.limit}` : pg``}`;
}

export async function deleteCost(id: string): Promise<void> {
  await ready();
  await getSql()`DELETE FROM cost_record WHERE id = ${id}`;
}

/** 平台 × 月份 成本矩阵，一眼看清每个平台每月投入 */
export async function costMatrix(year: number): Promise<{
  months: string[];
  rows: Array<{
    platformId: string;
    platformName: string;
    colorSlot: number;
    values: number[];
    total: number;
  }>;
  monthTotals: number[];
  grandTotal: number;
}> {
  await ready();

  const raw = await getSql()<
    Array<{
      platformId: string;
      platformName: string;
      colorSlot: number;
      month: string | null;
      total: number | null;
    }>
  >`
    SELECT p.id AS "platformId", p.name AS "platformName", p.color_slot AS "colorSlot",
           substr(r.cost_date, 6, 2) AS month, SUM(r.amount) AS total
    FROM platform p
    LEFT JOIN cost_record r
      ON r.platform_id = p.id AND substr(r.cost_date, 1, 4) = ${String(year)}
    WHERE p.active = 1
    GROUP BY p.id, p.name, p.color_slot, p.sort_order, substr(r.cost_date, 6, 2)
    ORDER BY p.sort_order`;

  const byPlatform = new Map<
    string,
    { platformId: string; platformName: string; colorSlot: number; values: number[]; total: number }
  >();

  for (const r of raw) {
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
      entry.values[Number(r.month) - 1] = Number(r.total);
      entry.total += Number(r.total);
    }
  }

  const rows = [...byPlatform.values()];
  const monthTotals = Array.from({ length: 12 }, (_, i) =>
    rows.reduce((sum, row) => sum + row.values[i], 0),
  );

  return {
    months: Array.from({ length: 12 }, (_, i) => `${i + 1}月`),
    rows,
    monthTotals,
    grandTotal: monthTotals.reduce((a, b) => a + b, 0),
  };
}
