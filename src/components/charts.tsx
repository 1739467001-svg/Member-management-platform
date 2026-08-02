"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { yuan, yuanCompact } from "@/lib/format";

/**
 * 手写 SVG 图表，不引第三方库：包体更小，配色与标注规则完全可控。
 * 共同约定：线宽 2px、数据端 4px 圆角、堆叠段之间留 2px 缝隙、单一纵轴、
 * 悬停十字准星 + 浮层、并提供「表格视图」——浅色模式下部分系列色对底色
 * 对比度低于 3:1，必须有非颜色通道能读到数值。
 */

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(720);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width] as const;
}

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const rough = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? mag * 10;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

function ViewToggle({ mode, onChange }: { mode: "chart" | "table"; onChange: (m: "chart" | "table") => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-line text-[11px]">
      {(["chart", "table"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          aria-pressed={mode === m}
          className={`px-2 py-1 transition-colors ${
            mode === m ? "bg-primary text-primary-ink" : "text-ink-3 hover:text-ink"
          }`}
        >
          {m === "chart" ? "图表" : "表格"}
        </button>
      ))}
    </div>
  );
}

function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5 text-[11px] text-ink-2">
          <span
            aria-hidden
            className="inline-block size-2 rounded-full"
            style={{ background: it.color }}
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/* ────────────────────────────────────────────────────
   折线图：收入趋势
   ──────────────────────────────────────────────────── */

export function TrendLine({
  data,
  height = 200,
  label = "收入",
}: {
  data: Array<{ date: string; value: number }>;
  height?: number;
  label?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [mode, setMode] = useState<"chart" | "table">("chart");

  const pad = { l: 46, r: 14, t: 14, b: 24 };
  const innerW = Math.max(10, width - pad.l - pad.r);
  const innerH = height - pad.t - pad.b;

  const max = Math.max(1, ...data.map((d) => d.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;

  const x = useCallback(
    (i: number) => pad.l + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW),
    [data.length, innerW, pad.l],
  );
  const y = useCallback((v: number) => pad.t + innerH - (v / top) * innerH, [innerH, pad.t, top]);

  const path = useMemo(
    () => data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.value)}`).join(" "),
    [data, x, y],
  );
  const area = useMemo(
    () =>
      data.length
        ? `${path} L${x(data.length - 1)},${pad.t + innerH} L${x(0)},${pad.t + innerH} Z`
        : "",
    [path, data.length, x, innerH, pad.t],
  );

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const ratio = (px - pad.l) / Math.max(1, innerW);
    const idx = Math.round(ratio * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, idx)));
  };

  if (mode === "table") {
    return (
      <div>
        <div className="mb-3 flex justify-end">
          <ViewToggle mode={mode} onChange={setMode} />
        </div>
        <div className="max-h-[220px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr>
                <th className="border-b border-line px-2 py-1.5 text-left text-xs font-medium text-ink-3">
                  日期
                </th>
                <th className="border-b border-line px-2 py-1.5 text-right text-xs font-medium text-ink-3">
                  {label}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.filter((d) => d.value > 0).reverse().map((d) => (
                <tr key={d.date}>
                  <td className="border-b border-line/50 px-2 py-1.5 text-ink-2 tnum">{d.date}</td>
                  <td className="border-b border-line/50 px-2 py-1.5 text-right tnum">
                    {yuan(d.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const active = hover !== null ? data[hover] : null;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <Legend items={[{ label, color: "var(--series-1)" }]} />
        <ViewToggle mode={mode} onChange={setMode} />
      </div>

      <div ref={ref} className="relative">
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label={`${label}趋势图`}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={pad.l}
                x2={width - pad.r}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--grid)"
                strokeWidth={1}
              />
              <text
                x={pad.l - 8}
                y={y(t) + 3.5}
                textAnchor="end"
                fontSize={10}
                fill="var(--ink-3)"
                className="tnum"
              >
                {t === 0 ? "0" : yuanCompact(t)}
              </text>
            </g>
          ))}

          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--series-1)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {data.length > 1 && <path d={area} fill="url(#trendFill)" />}
          <path
            d={path}
            fill="none"
            stroke="var(--series-1)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* 首尾日期标注 */}
          {data.length > 0 && (
            <>
              <text x={pad.l} y={height - 6} fontSize={10} fill="var(--ink-3)" className="tnum">
                {data[0].date.slice(5)}
              </text>
              <text
                x={width - pad.r}
                y={height - 6}
                textAnchor="end"
                fontSize={10}
                fill="var(--ink-3)"
                className="tnum"
              >
                {data[data.length - 1].date.slice(5)}
              </text>
            </>
          )}

          {hover !== null && active && (
            <g>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={pad.t}
                y2={pad.t + innerH}
                stroke="var(--axis)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              {/* 底色描边环，保证圆点压在线上也看得清 */}
              <circle cx={x(hover)} cy={y(active.value)} r={5.5} fill="var(--card)" />
              <circle
                cx={x(hover)}
                cy={y(active.value)}
                r={4.5}
                fill="var(--series-1)"
                stroke="var(--card)"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>

        {hover !== null && active && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs shadow-[var(--shadow-pop)]"
            style={{
              left: Math.min(Math.max(x(hover), 56), width - 56),
              top: Math.max(0, y(active.value) - 46),
            }}
          >
            <div className="text-ink-3 tnum">{active.date}</div>
            <div className="font-semibold text-ink tnum">{yuan(active.value)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────
   堆叠柱状图：各平台收入构成
   ──────────────────────────────────────────────────── */

export function StackedBars({
  periods,
  series,
  height = 240,
}: {
  periods: string[];
  series: Array<{ platformId: string; platformName: string; colorSlot: number; values: number[] }>;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [mode, setMode] = useState<"chart" | "table">("chart");

  const pad = { l: 46, r: 14, t: 16, b: 28 };
  const innerW = Math.max(10, width - pad.l - pad.r);
  const innerH = height - pad.t - pad.b;

  const totals = periods.map((_, i) => series.reduce((s, ser) => s + (ser.values[i] || 0), 0));
  const max = Math.max(1, ...totals);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;

  const slotW = innerW / Math.max(1, periods.length);
  const barW = Math.min(44, slotW * 0.62);
  const y = (v: number) => pad.t + innerH - (v / top) * innerH;

  const legendItems = series.map((s) => ({
    label: s.platformName,
    color: `var(--series-${((s.colorSlot - 1) % 5) + 1})`,
  }));

  if (mode === "table") {
    return (
      <div>
        <div className="mb-3 flex justify-end">
          <ViewToggle mode={mode} onChange={setMode} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr>
                <th className="border-b border-line px-2 py-1.5 text-left text-xs font-medium text-ink-3">
                  平台
                </th>
                {periods.map((p) => (
                  <th
                    key={p}
                    className="border-b border-line px-2 py-1.5 text-right text-xs font-medium text-ink-3"
                  >
                    {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {series.map((s) => (
                <tr key={s.platformId}>
                  <td className="border-b border-line/50 px-2 py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="inline-block size-2 rounded-full"
                        style={{ background: `var(--series-${((s.colorSlot - 1) % 5) + 1})` }}
                      />
                      {s.platformName}
                    </span>
                  </td>
                  {s.values.map((v, i) => (
                    <td key={i} className="border-b border-line/50 px-2 py-1.5 text-right tnum">
                      {v > 0 ? yuan(v) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="font-medium">
                <td className="px-2 py-1.5">合计</td>
                {totals.map((t, i) => (
                  <td key={i} className="px-2 py-1.5 text-right tnum">
                    {yuan(t)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Legend items={legendItems} />
        <ViewToggle mode={mode} onChange={setMode} />
      </div>

      <div ref={ref} className="relative">
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label="各平台收入堆叠图"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={pad.l}
                x2={width - pad.r}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--grid)"
                strokeWidth={1}
              />
              <text
                x={pad.l - 8}
                y={y(t) + 3.5}
                textAnchor="end"
                fontSize={10}
                fill="var(--ink-3)"
                className="tnum"
              >
                {t === 0 ? "0" : yuanCompact(t)}
              </text>
            </g>
          ))}

          {periods.map((label, i) => {
            const cx = pad.l + slotW * i + slotW / 2;
            let cursor = 0;

            return (
              <g
                key={label + i}
                onMouseEnter={() => setHover(i)}
                onMouseMove={() => setHover(i)}
              >
                {/* 加宽的透明命中区，比柱子本身更好点 */}
                <rect
                  x={pad.l + slotW * i}
                  y={pad.t}
                  width={slotW}
                  height={innerH}
                  fill={hover === i ? "var(--card-sunken)" : "transparent"}
                  opacity={hover === i ? 0.7 : 0}
                />
                {series.map((s) => {
                  const v = s.values[i] || 0;
                  if (v <= 0) return null;
                  const h = (v / top) * innerH;
                  const yTop = pad.t + innerH - cursor - h;
                  cursor += h;
                  const isTop = cursor >= (totals[i] / top) * innerH - 0.5;
                  return (
                    <rect
                      key={s.platformId}
                      x={cx - barW / 2}
                      // 段与段之间留 2px 底色缝隙，堆叠边界不靠颜色区分
                      y={yTop}
                      width={barW}
                      height={Math.max(1, h - 2)}
                      rx={isTop ? 4 : 0}
                      fill={`var(--series-${((s.colorSlot - 1) % 5) + 1})`}
                    />
                  );
                })}
                {totals[i] > 0 && (
                  <text
                    x={cx}
                    y={y(totals[i]) - 6}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={600}
                    fill="var(--ink-2)"
                    className="tnum"
                  >
                    {yuanCompact(totals[i])}
                  </text>
                )}
                <text
                  x={cx}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--ink-3)"
                >
                  {label}
                </text>
              </g>
            );
          })}
        </svg>

        {hover !== null && totals[hover] > 0 && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-line bg-card px-2.5 py-2 text-xs shadow-[var(--shadow-pop)]"
            style={{
              left: Math.min(Math.max(pad.l + slotW * hover + slotW / 2, 70), width - 70),
              top: Math.max(0, y(totals[hover]) - 18),
            }}
          >
            <div className="mb-1 font-medium text-ink">{periods[hover]}</div>
            {series
              .filter((s) => (s.values[hover] || 0) > 0)
              .map((s) => (
                <div key={s.platformId} className="flex items-center gap-2 whitespace-nowrap">
                  <span
                    aria-hidden
                    className="inline-block size-1.5 rounded-full"
                    style={{ background: `var(--series-${((s.colorSlot - 1) % 5) + 1})` }}
                  />
                  <span className="text-ink-2">{s.platformName}</span>
                  <span className="ml-auto tnum text-ink">{yuan(s.values[hover])}</span>
                </div>
              ))}
            <div className="mt-1 border-t border-line pt-1 text-right font-semibold tnum text-ink">
              {yuan(totals[hover])}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────
   横向条形图：平台毛利对比（含正负）
   ──────────────────────────────────────────────────── */

export function ProfitBars({
  rows,
}: {
  rows: Array<{ platformName: string; colorSlot: number; revenue: number; cost: number; profit: number }>;
}) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.profit)), ...rows.map((r) => r.revenue));

  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const ratio = Math.min(1, Math.abs(r.profit) / max);
        const negative = r.profit < 0;
        return (
          <li key={r.platformName}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                <span
                  aria-hidden
                  className="inline-block size-2 rounded-full"
                  style={{ background: `var(--series-${((r.colorSlot - 1) % 5) + 1})` }}
                />
                {r.platformName}
              </span>
              <span className="flex items-center gap-2 tnum">
                <span className="text-ink-3">
                  收 {yuanCompact(r.revenue)} · 成本 {yuanCompact(r.cost)}
                </span>
                <span className={`font-semibold ${negative ? "text-critical" : "text-ink"}`}>
                  {negative ? "▼ " : ""}
                  {yuan(r.profit)}
                </span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-sunken">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${Math.max(2, ratio * 100)}%`,
                  background: negative
                    ? "var(--critical)"
                    : `var(--series-${((r.colorSlot - 1) % 5) + 1})`,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
