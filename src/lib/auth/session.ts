/**
 * 会话令牌：HMAC-SHA256 签名的无状态 Cookie。
 * 刻意使用 Web Crypto 而非 node:crypto —— middleware 跑在 Edge 运行时，
 * 这样签发与校验可以共用同一份实现。
 */

export const SESSION_COOKIE = "hh_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 天

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    // 缺省值仅为让开发环境可跑；生产必须在 .env 配置
    return "hhstudio-dev-secret-do-not-use-in-production";
  }
  return secret;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function getKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSessionToken(): Promise<string> {
  const payload = toBase64Url(
    new TextEncoder().encode(
      JSON.stringify({ exp: Date.now() + SESSION_MAX_AGE * 1000 }),
    ),
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    await getKey(),
    new TextEncoder().encode(payload),
  );
  return `${payload}.${toBase64Url(new Uint8Array(sig))}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;

  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await getKey(),
      fromBase64Url(sig),
      new TextEncoder().encode(payload),
    );
    if (!valid) return false;

    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    return typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}
