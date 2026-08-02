import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const KEY_LEN = 64;

/** scrypt 哈希，格式 `salt:hash`（均为 hex） */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, KEY_LEN);
  // 长度不等时 timingSafeEqual 会抛错，先挡掉
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
