import "server-only";
import { sqlite, db, platforms, priceRules } from "../db";
import { eq, and } from "drizzle-orm";
import { hashPassword, verifyPassword } from "../auth/password";
import type { Platform } from "../db/schema";

export function getSetting(key: string): string | null {
  const row = sqlite.prepare(`SELECT value FROM app_setting WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  sqlite
    .prepare(
      `INSERT INTO app_setting (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

export function getNumberSetting(key: string, fallback: number): number {
  const raw = getSetting(key);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/* ── 平台 ───────────────────────────────────────────── */

export function listPlatforms(includeInactive = false): Platform[] {
  const rows = db.select().from(platforms).all();
  return rows
    .filter((p) => includeInactive || p.active === 1)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** 解析器需要的轻量形态 */
export function platformsForParser() {
  return listPlatforms().map((p) => ({
    id: p.id,
    name: p.name,
    aliases: p.aliases.split(",").map((a) => a.trim()).filter(Boolean),
  }));
}

export function updatePlatform(
  id: string,
  patch: Partial<{ name: string; aliases: string; active: number }>,
): void {
  db.update(platforms).set(patch).where(eq(platforms.id, id)).run();
}

/* ── 定价规则 ───────────────────────────────────────── */

export type PriceTable = Array<{
  platformId: string;
  platformName: string;
  colorSlot: number;
  newPrice: number;
  returningPrice: number;
}>;

export function getPriceTable(): PriceTable {
  return listPlatforms().map((p) => {
    const rules = db.select().from(priceRules).where(eq(priceRules.platformId, p.id)).all();
    return {
      platformId: p.id,
      platformName: p.name,
      colorSlot: p.colorSlot,
      newPrice: rules.find((r) => r.customerType === "new")?.price ?? 0,
      returningPrice: rules.find((r) => r.customerType === "returning")?.price ?? 0,
    };
  });
}

export function setPrice(
  platformId: string,
  customerType: "new" | "returning",
  price: number,
): void {
  const existing = db
    .select()
    .from(priceRules)
    .where(and(eq(priceRules.platformId, platformId), eq(priceRules.customerType, customerType)))
    .get();

  if (existing) {
    db.update(priceRules).set({ price }).where(eq(priceRules.id, existing.id)).run();
  } else {
    db.insert(priceRules)
      .values({ id: `${platformId}-${customerType}`, platformId, customerType, price })
      .run();
  }
}

/* ── 密码 ───────────────────────────────────────────── */

export function checkPassword(password: string): boolean {
  const stored = getSetting("passwordHash");
  return stored ? verifyPassword(password, stored) : false;
}

export function changePassword(current: string, next: string): boolean {
  if (!checkPassword(current)) return false;
  setSetting("passwordHash", hashPassword(next));
  return true;
}
