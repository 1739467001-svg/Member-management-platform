import "server-only";
import { getSql, ready } from "../db";
import { hashPassword, verifyPassword } from "../auth/password";
import type { Account, Platform } from "../db/schema";

export async function getSetting(key: string): Promise<string | null> {
  await ready();
  const rows = await getSql()<{ value: string }[]>`
    SELECT value FROM app_setting WHERE key = ${key}`;
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await ready();
  await getSql()`
    INSERT INTO app_setting (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}

/* ── 平台 ───────────────────────────────────────────── */

export async function listPlatforms(includeInactive = false): Promise<Platform[]> {
  await ready();
  const pg = getSql();
  return includeInactive
    ? await pg<Platform[]>`
        SELECT id, name, aliases, color_slot AS "colorSlot",
               sort_order AS "sortOrder", active
        FROM platform ORDER BY sort_order`
    : await pg<Platform[]>`
        SELECT id, name, aliases, color_slot AS "colorSlot",
               sort_order AS "sortOrder", active
        FROM platform WHERE active = 1 ORDER BY sort_order`;
}

/** 解析器需要的轻量形态 */
export async function platformsForParser() {
  const rows = await listPlatforms();
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    aliases: p.aliases.split(",").map((a) => a.trim()).filter(Boolean),
  }));
}

export async function updatePlatform(
  id: string,
  patch: { name?: string; aliases?: string; active?: number },
): Promise<void> {
  await ready();
  const pg = getSql();
  if (patch.name !== undefined) {
    await pg`UPDATE platform SET name = ${patch.name} WHERE id = ${id}`;
  }
  if (patch.aliases !== undefined) {
    await pg`UPDATE platform SET aliases = ${patch.aliases} WHERE id = ${id}`;
  }
  if (patch.active !== undefined) {
    await pg`UPDATE platform SET active = ${patch.active} WHERE id = ${id}`;
  }
}

/* ── 会员账号 ───────────────────────────────────────── */

export async function listAccounts(includeInactive = false): Promise<Account[]> {
  await ready();
  const pg = getSql();
  return includeInactive
    ? await pg<Account[]>`
        SELECT id, label, note, active, sort_order AS "sortOrder",
               created_at AS "createdAt"
        FROM account ORDER BY sort_order, label`
    : await pg<Account[]>`
        SELECT id, label, note, active, sort_order AS "sortOrder",
               created_at AS "createdAt"
        FROM account WHERE active = 1 ORDER BY sort_order, label`;
}

/** 解析器需要的轻量形态。停用的账号不参与识别，避免录到已裁撤的号上 */
export async function accountsForParser() {
  const rows = await listAccounts();
  return rows.map((a) => ({ id: a.id, label: a.label }));
}

export async function createAccount(label: string, note = ""): Promise<string> {
  await ready();
  const trimmed = label.trim();
  const id = `acc-${trimmed}`;
  const existing = await listAccounts(true);
  await getSql()`
    INSERT INTO account (id, label, note, active, sort_order, created_at)
    VALUES (${id}, ${trimmed}, ${note}, 1, ${existing.length}, ${Date.now()})
    ON CONFLICT (id) DO NOTHING`;
  return id;
}

export async function updateAccount(
  id: string,
  patch: { label?: string; note?: string; active?: number },
): Promise<void> {
  await ready();
  const pg = getSql();
  if (patch.label !== undefined) {
    await pg`UPDATE account SET label = ${patch.label} WHERE id = ${id}`;
  }
  if (patch.note !== undefined) {
    await pg`UPDATE account SET note = ${patch.note} WHERE id = ${id}`;
  }
  if (patch.active !== undefined) {
    await pg`UPDATE account SET active = ${patch.active} WHERE id = ${id}`;
  }
}

/* ── 定价规则 ───────────────────────────────────────── */

export type PriceTable = Array<{
  platformId: string;
  platformName: string;
  colorSlot: number;
  newPrice: number;
  returningPrice: number;
}>;

export async function getPriceTable(): Promise<PriceTable> {
  await ready();
  const rows = await getSql()<
    Array<{
      platformId: string;
      platformName: string;
      colorSlot: number;
      newPrice: number | null;
      returningPrice: number | null;
    }>
  >`
    SELECT p.id AS "platformId", p.name AS "platformName", p.color_slot AS "colorSlot",
           MAX(CASE WHEN r.customer_type = 'new' THEN r.price END) AS "newPrice",
           MAX(CASE WHEN r.customer_type = 'returning' THEN r.price END) AS "returningPrice"
    FROM platform p
    LEFT JOIN price_rule r ON r.platform_id = p.id
    WHERE p.active = 1
    GROUP BY p.id, p.name, p.color_slot, p.sort_order
    ORDER BY p.sort_order`;

  return rows.map((r) => ({
    platformId: r.platformId,
    platformName: r.platformName,
    colorSlot: r.colorSlot,
    newPrice: r.newPrice ?? 0,
    returningPrice: r.returningPrice ?? 0,
  }));
}

export async function setPrice(
  platformId: string,
  customerType: "new" | "returning",
  price: number,
): Promise<void> {
  await ready();
  await getSql()`
    INSERT INTO price_rule (id, platform_id, customer_type, price)
    VALUES (${`${platformId}-${customerType}`}, ${platformId}, ${customerType}, ${price})
    ON CONFLICT (platform_id, customer_type) DO UPDATE SET price = EXCLUDED.price`;
}

/* ── 密码 ───────────────────────────────────────────── */

export async function checkPassword(password: string): Promise<boolean> {
  const stored = await getSetting("passwordHash");
  return stored ? verifyPassword(password, stored) : false;
}

export async function changePassword(current: string, next: string): Promise<boolean> {
  if (!(await checkPassword(current))) return false;
  await setSetting("passwordHash", hashPassword(next));
  return true;
}
