/** 展示层格式化。纯函数，客户端组件可直接引用 */

export function yuan(n: number, decimals = 2): string {
  return `¥${n.toFixed(decimals)}`;
}

/** 紧凑金额：整数不带小数，便于 KPI 大数字 */
export function yuanCompact(n: number): string {
  return Number.isInteger(n) ? `¥${n}` : `¥${n.toFixed(2)}`;
}

export function pct(n: number, decimals = 1): string {
  return `${(n * 100).toFixed(decimals)}%`;
}

export function signedPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(1)}%`;
}

/** 图表系列色：跟随平台的固定槽位，绝不因筛选而重排 */
export function seriesColor(slot: number): string {
  const s = ((slot - 1) % 5) + 1;
  return `var(--series-${s})`;
}

export function initials(name: string): string {
  return name.trim().slice(0, 1) || "?";
}

export function truncate(text: string, max = 24): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}
