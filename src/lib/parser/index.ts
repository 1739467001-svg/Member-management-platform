import { DEFAULT_PLATFORMS, DURATION_PRESETS } from "../constants";
import { addDays, computeEndDate, diffDays, isValidDate, today } from "../date";
import {
  CITIES,
  COST_KEYWORDS,
  CUSTOMER_TYPE_KEYWORDS,
  DEVICE_DISPLAY,
  DEVICE_KEYWORDS,
  DURATION_KEYWORDS,
  PROVINCES,
} from "./dictionaries";

/**
 * 一行文字 → 结构化记录。
 * 纯函数、无副作用、不依赖 Node API —— 客户端跑它做实时预览，
 * 服务端保存时再跑一次，两边结果一致。
 */

export type PlatformLite = { id: string; name: string; aliases: string[] };

export type ParsedOrder = {
  kind: "order";
  customerName: string | null;
  platformId: string | null;
  price: number | null;
  startDate: string | null;
  durationDays: number;
  durationType: string;
  endDate: string | null;
  /** null 表示文本里没写，交由系统按历史记录判定 */
  customerType: "new" | "returning" | null;
  device: string;
  region: string;
  note: string;
  raw: string;
  /** 缺失的必填字段，UI 据此标红 */
  missing: string[];
  /** 文本里没写、由系统推断出来的字段，UI 据此提示「已默认为…」 */
  inferred: string[];
};

export type ParsedCost = {
  kind: "cost";
  platformId: string | null;
  amount: number | null;
  costDate: string | null;
  periodDays: number;
  note: string;
  raw: string;
  missing: string[];
};

export type ParsedLine = ParsedOrder | ParsedCost;

/* ── 扫描器：按「已消费区间」逐项抽取，避免同一段文字被两个规则重复吃掉 ── */

class Scanner {
  readonly text: string;
  private used: boolean[];

  constructor(text: string) {
    this.text = text;
    this.used = new Array(text.length).fill(false);
  }

  private isFree(start: number, end: number): boolean {
    for (let i = start; i < end; i++) if (this.used[i]) return false;
    return true;
  }

  consume(start: number, end: number): void {
    for (let i = start; i < end; i++) this.used[i] = true;
  }

  /** 找到第一个完全落在未消费区域的匹配 */
  find(pattern: RegExp): RegExpExecArray | null {
    const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
    const re = new RegExp(pattern.source, flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (this.isFree(m.index, m.index + m[0].length)) return m;
    }
    return null;
  }

  /** 找到并消费 */
  take(pattern: RegExp): RegExpExecArray | null {
    const m = this.find(pattern);
    if (m) this.consume(m.index, m.index + m[0].length);
    return m;
  }

  /** 剩余未消费的片段（按分隔符切分，已去空） */
  leftovers(): string[] {
    const parts: string[] = [];
    let buf = "";
    for (let i = 0; i < this.text.length; i++) {
      const ch = this.text[i];
      if (this.used[i] || /[\s,，、;；|/\\]/.test(ch)) {
        if (buf) parts.push(buf);
        buf = "";
      } else {
        buf += ch;
      }
    }
    if (buf) parts.push(buf);
    return parts.filter((p) => p.trim().length > 0);
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 字面量集合 → 正则（长的优先，避免「腾讯」抢在「腾讯视频」之前匹配） */
function literalPattern(words: readonly string[]): RegExp {
  const sorted = [...words].sort((a, b) => b.length - a.length);
  return new RegExp(sorted.map(escapeRe).join("|"), "i");
}

/* ── 各字段抽取 ─────────────────────────────────────── */

function normalize(input: string): string {
  return input
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[【\[]/g, "(")
    .replace(/[】\]]/g, ")")
    .replace(/：/g, ":")
    .replace(/ /g, " ")
    .trim();
}

function extractNote(s: Scanner): string {
  const notes: string[] = [];

  // 括号内容
  let m = s.take(/\(([^)]*)\)/);
  while (m) {
    if (m[1].trim()) notes.push(m[1].trim());
    m = s.take(/\(([^)]*)\)/);
  }

  // 「备注:xxx」直到行尾或分隔符
  const tagged = s.take(/备注\s*:?\s*([^\s,，;；]+)/);
  if (tagged?.[1]) notes.push(tagged[1].trim());

  return notes.join(" ");
}

function extractDate(s: Scanner): string | null {
  const base = today();

  // 相对日期
  const rel = s.take(/今天|今日|明天|明日|昨天|昨日|前天|后天/);
  if (rel) {
    const map: Record<string, number> = {
      今天: 0, 今日: 0, 明天: 1, 明日: 1,
      昨天: -1, 昨日: -1, 前天: -2, 后天: 2,
    };
    return addDays(base, map[rel[0]] ?? 0);
  }

  // 完整日期：2026.8.02 / 2026-08-02 / 2026/8/2 / 2026年8月2日
  const full = s.take(/(\d{4})\s*[.\-/年]\s*(\d{1,2})\s*[.\-/月]\s*(\d{1,2})\s*日?/);
  if (full) {
    const iso = `${full[1]}-${full[2].padStart(2, "0")}-${full[3].padStart(2, "0")}`;
    if (isValidDate(iso)) return iso;
  }

  // 月日：8.02 / 8-2 / 8月2日（补当前年）
  const md = s.take(/(?<![\d.])(\d{1,2})\s*[.\-/月]\s*(\d{1,2})\s*日?(?![\d.])/);
  if (md) {
    const month = Number(md[1]);
    const day = Number(md[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const iso = `${base.slice(0, 4)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (isValidDate(iso)) return iso;
    }
  }

  return null;
}

type DurationHit = { days: number; type: string } | null;

function extractDuration(s: Scanner): DurationHit {
  // 「剩余 15 天」「还有 15 天」—— 自定义到期剩余时长
  const remain = s.take(/(?:剩余|还剩|还有)\s*(\d{1,3})\s*天/);
  if (remain) return { days: Number(remain[1]), type: "custom" };

  // 卡种关键词
  for (const { words, days, type } of DURATION_KEYWORDS) {
    if (s.take(literalPattern(words))) return { days, type };
  }

  // 「N 个月」
  const months = s.take(/(\d{1,2})\s*个月/);
  if (months) {
    const days = Number(months[1]) * 30;
    return { days, type: days === 30 ? "month" : days === 90 ? "quarter" : "custom" };
  }

  // 「N 天」
  const days = s.take(/(\d{1,3})\s*天/);
  if (days) {
    const n = Number(days[1]);
    return { days: n, type: n === 30 ? "month" : n === 90 ? "quarter" : n === 1 ? "day" : "custom" };
  }

  return null;
}

/** 「到期 2026.8.20」——直接指定到期日 */
function extractExplicitEnd(s: Scanner): string | null {
  const m = s.find(/(?:到期|截止|结束)\s*:?\s*(\d{4}\s*[.\-/年]\s*\d{1,2}\s*[.\-/月]\s*\d{1,2}\s*日?|\d{1,2}\s*[.\-/月]\s*\d{1,2}\s*日?)/);
  if (!m) return null;
  s.consume(m.index, m.index + m[0].length);

  const inner = new Scanner(m[1]);
  return extractDate(inner);
}

function extractPlatform(s: Scanner, platforms: PlatformLite[]): string | null {
  const entries = platforms
    .flatMap((p) => p.aliases.map((a) => ({ id: p.id, alias: a })))
    .sort((a, b) => b.alias.length - a.alias.length);

  for (const { id, alias } of entries) {
    if (!s.take(new RegExp(escapeRe(alias), "i"))) continue;

    // 同一平台可能被写了不止一个称呼（如「b站 大会员」），
    // 把其余别名一并消费掉，否则会当成客户名或备注残留下来
    const others = platforms.find((p) => p.id === id)?.aliases ?? [];
    for (const other of [...others].sort((a, b) => b.length - a.length)) {
      while (s.take(new RegExp(escapeRe(other), "i"))) {
        /* 反复消费同一别名的多次出现 */
      }
    }
    return id;
  }
  return null;
}

/** 仅有月份，如「8月」——用于成本记录（该月花费多少） */
function extractMonthOnly(s: Scanner): string | null {
  const m = s.take(/(\d{1,2})\s*月(?!\d)/);
  if (!m) return null;
  const month = Number(m[1]);
  if (month < 1 || month > 12) return null;
  return `${today().slice(0, 4)}-${String(month).padStart(2, "0")}-01`;
}

function extractDevice(s: Scanner): string {
  const brands = [...DEVICE_KEYWORDS].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    `(?:${brands.map(escapeRe).join("|")})(?:\\s?[a-z0-9]+)?(?:\\s?(?:pro|plus|max|ultra|mini|air)\\b)*`,
    "i",
  );
  const m = s.take(pattern);
  if (!m) return "";

  const raw = m[0].trim();
  // 规范化常见品牌大小写：iphone17 → iPhone17
  const lower = raw.toLowerCase();
  for (const [key, display] of Object.entries(DEVICE_DISPLAY)) {
    if (lower.startsWith(key)) return display + raw.slice(key.length);
  }
  return raw;
}

function extractRegion(s: Scanner): string {
  // 省 + 市 连写，如「浙江杭州」
  const provinceRe = literalPattern(PROVINCES);
  const cityRe = literalPattern(CITIES);

  const combined = new RegExp(
    `(?:${[...PROVINCES].sort((a, b) => b.length - a.length).map(escapeRe).join("|")})` +
      `\\s*(?:省|市|自治区|特别行政区)?\\s*` +
      `(?:${[...CITIES].sort((a, b) => b.length - a.length).map(escapeRe).join("|")})` +
      `(?:市)?`,
  );
  const both = s.take(combined);
  if (both) return both[0].replace(/\s+/g, "");

  const city = s.take(new RegExp(cityRe.source + "(?:市)?", "i"));
  if (city) return city[0].replace(/\s+/g, "");

  const province = s.take(new RegExp(provinceRe.source + "(?:省|自治区)?", "i"));
  if (province) return province[0].replace(/\s+/g, "");

  return "";
}

function extractCustomerType(s: Scanner): "new" | "returning" | null {
  for (const { words, type } of CUSTOMER_TYPE_KEYWORDS) {
    if (s.take(literalPattern(words))) return type;
  }
  return null;
}

function extractPrice(s: Scanner): number | null {
  const isBoundary = (ch: string | undefined) => ch === undefined || !/[0-9a-zA-Z]/.test(ch);

  // 先找带货币标记的，可靠性更高
  const explicit = s.find(/[¥￥]\s*(\d{1,4}(?:\.\d{1,2})?)|(\d{1,4}(?:\.\d{1,2})?)\s*(?:元|块|rmb)/i);
  if (explicit) {
    s.consume(explicit.index, explicit.index + explicit[0].length);
    return Number(explicit[1] ?? explicit[2]);
  }

  // 再找裸数字，但必须前后都不与字母数字相连（避免吃掉 iphone17 的 17）
  const re = /\d{1,4}(?:\.\d{1,2})?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s.text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (!isBoundary(s.text[start - 1]) || !isBoundary(s.text[end])) continue;
    const found = s.find(new RegExp(`(?:^|)${escapeRe(m[0])}`));
    if (found && found.index === start) {
      s.consume(start, end);
      return Number(m[0]);
    }
  }
  return null;
}

/* ── 对外入口 ───────────────────────────────────────── */

export function looksLikeCost(text: string): boolean {
  return COST_KEYWORDS.some((k) => text.includes(k));
}

export function parseOrderLine(
  input: string,
  platforms: PlatformLite[] = DEFAULT_PLATFORMS.map((p) => ({
    id: p.id,
    name: p.name,
    aliases: [...p.aliases],
  })),
): ParsedOrder {
  const raw = input.trim();
  const s = new Scanner(normalize(raw));

  // 顺序有讲究：备注先摘走（括号内文字不参与其他识别）；
  // 日期先于价格，否则「8.02」会被当成价格。
  const note = extractNote(s);
  const explicitEnd = extractExplicitEnd(s);
  const duration = extractDuration(s);
  const startDate = extractDate(s);
  const platformId = extractPlatform(s, platforms);
  const device = extractDevice(s);
  const region = extractRegion(s);
  const customerType = extractCustomerType(s);
  const price = extractPrice(s);

  const rest = s.leftovers();
  const customerName = rest.length > 0 ? rest[0] : null;
  const extraNote = rest.slice(1).join(" ");

  const start = startDate ?? today();
  let durationDays = duration?.days ?? DURATION_PRESETS.month;
  let durationType = duration?.type ?? "month";

  // 显式写了到期日时，反推有效天数
  if (explicitEnd) {
    const d = diffDays(start, explicitEnd);
    if (d > 0) {
      durationDays = d;
      durationType = d === 30 ? "month" : d === 90 ? "quarter" : "custom";
    }
  }

  const missing: string[] = [];
  if (!customerName) missing.push("customerName");
  if (!platformId) missing.push("platformId");
  if (price === null) missing.push("price");

  // 日期不写就是今天——这是最常见的录入场景，不该拦着不让存
  const inferred: string[] = [];
  if (!startDate) inferred.push("startDate");
  if (!duration && !explicitEnd) inferred.push("durationDays");

  return {
    kind: "order",
    customerName,
    platformId,
    price,
    startDate: start,
    durationDays,
    durationType,
    endDate: computeEndDate(start, durationDays),
    customerType,
    device,
    region,
    note: [note, extraNote].filter(Boolean).join(" "),
    raw,
    missing,
    inferred,
  };
}

export function parseCostLine(
  input: string,
  platforms: PlatformLite[] = DEFAULT_PLATFORMS.map((p) => ({
    id: p.id,
    name: p.name,
    aliases: [...p.aliases],
  })),
): ParsedCost {
  const raw = input.trim();
  const s = new Scanner(normalize(raw));

  const note = extractNote(s);
  // 成本触发词本身不参与后续识别
  s.take(literalPattern(COST_KEYWORDS));
  const duration = extractDuration(s);
  // 「8月」这种只写月份的写法在成本场景很常见，归到当月 1 号
  const costDate = extractDate(s) ?? extractMonthOnly(s);
  const platformId = extractPlatform(s, platforms);
  const amount = extractPrice(s);

  const rest = s.leftovers().join(" ");

  const missing: string[] = [];
  if (!platformId) missing.push("platformId");
  if (amount === null) missing.push("amount");

  return {
    kind: "cost",
    platformId,
    amount,
    costDate: costDate ?? today(),
    periodDays: duration?.days ?? 30,
    note: [note, rest].filter(Boolean).join(" "),
    raw,
    missing,
  };
}

export function parseLine(input: string, platforms?: PlatformLite[]): ParsedLine {
  return looksLikeCost(input)
    ? parseCostLine(input, platforms)
    : parseOrderLine(input, platforms);
}

/** 多行批量录入：每行一条 */
export function parseBatch(input: string, platforms?: PlatformLite[]): ParsedLine[] {
  return input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => parseLine(l, platforms));
}
