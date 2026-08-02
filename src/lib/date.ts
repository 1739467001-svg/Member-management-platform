/**
 * 全系统日期约定：一律使用 'YYYY-MM-DD' 纯日历日字符串。
 * 内部换算走 UTC 毫秒，避开本地时区导致的 ±1 天漂移；
 * 「今天」按业务时区（默认 Asia/Shanghai）取。
 */

export const TZ = process.env.TZ || "Asia/Shanghai";
const DAY_MS = 86_400_000;

/** 业务时区下的今天 */
export function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function toUTC(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(toUTC(date));
}

export function addDays(date: string, days: number): string {
  return fromUTC(toUTC(date) + days * DAY_MS);
}

/** to − from，单位天（可为负） */
export function diffDays(from: string, to: string): number {
  return Math.round((toUTC(to) - toUTC(from)) / DAY_MS);
}

/** 距到期还有几天：0 表示今天到期，负数表示已过期 */
export function daysRemaining(endDate: string): number {
  return diffDays(today(), endDate);
}

/** 有效期：起始日 + N 天。约定 startDate 当天算第 1 天，故到期日 = start + N − 1 …
 * 但业务口径按「买了 30 天，30 天后到期」理解，故直接 start + N。 */
export function computeEndDate(startDate: string, durationDays: number): string {
  return addDays(startDate, durationDays);
}

/* ── 周期区间（用于周报/月报/年报） ───────────────────── */

export type Period = { start: string; end: string; label: string; key: string };

/** 自然周，周一为起点 */
export function weekOf(date: string): Period {
  const dow = new Date(toUTC(date)).getUTCDay(); // 0=周日
  const offset = dow === 0 ? -6 : 1 - dow;
  const start = addDays(date, offset);
  const end = addDays(start, 6);
  return {
    start,
    end,
    key: start,
    label: `${start.slice(5).replace("-", "/")} – ${end.slice(5).replace("-", "/")}`,
  };
}

export function monthOf(date: string): Period {
  const [y, m] = date.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = fromUTC(Date.UTC(y, m, 0)); // 下月第 0 天 = 本月最后一天
  return { start, end, key: start.slice(0, 7), label: `${y}年${m}月` };
}

export function yearOf(date: string): Period {
  const y = Number(date.slice(0, 4));
  return {
    start: `${y}-01-01`,
    end: `${y}-12-31`,
    key: String(y),
    label: `${y}年`,
  };
}

export function periodOf(granularity: "week" | "month" | "year", date: string): Period {
  if (granularity === "week") return weekOf(date);
  if (granularity === "year") return yearOf(date);
  return monthOf(date);
}

/** 上一个同类周期，用于环比 */
export function previousPeriod(granularity: "week" | "month" | "year", p: Period): Period {
  if (granularity === "week") return weekOf(addDays(p.start, -7));
  if (granularity === "year") return yearOf(`${Number(p.key) - 1}-01-01`);
  return monthOf(addDays(p.start, -1));
}

/** 最近 n 个周期，由远及近 */
export function recentPeriods(
  granularity: "week" | "month" | "year",
  n: number,
  from = today(),
): Period[] {
  const out: Period[] = [];
  let cursor = periodOf(granularity, from);
  for (let i = 0; i < n; i++) {
    out.unshift(cursor);
    cursor = previousPeriod(granularity, cursor);
  }
  return out;
}

/** 最近 n 天的日期序列，由远及近 */
export function recentDays(n: number, from = today()): string[] {
  return Array.from({ length: n }, (_, i) => addDays(from, i - n + 1));
}

/* ── 展示格式化 ──────────────────────────────────────── */

export function formatDate(date: string): string {
  if (!date) return "—";
  const [, m, d] = date.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

export function formatDateFull(date: string): string {
  if (!date) return "—";
  const [y, m, d] = date.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

/** 剩余天数的自然语言表述 */
export function remainingLabel(days: number): string {
  if (days < 0) return `已过期 ${Math.abs(days)} 天`;
  if (days === 0) return "今天到期";
  if (days === 1) return "明天到期";
  return `剩余 ${days} 天`;
}
