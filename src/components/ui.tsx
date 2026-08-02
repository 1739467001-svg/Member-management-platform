import type { ReactNode } from "react";
import { signedPct } from "@/lib/format";

/* ── 卡片 ───────────────────────────────────────────── */

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`card-surface ${padded ? "p-5" : ""} ${className}`}>{children}</section>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

/* ── 指标卡 ─────────────────────────────────────────── */

export function StatTile({
  label,
  value,
  delta,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  delta?: number;
  hint?: ReactNode;
  tone?: "default" | "primary" | "good" | "critical";
}) {
  const valueTone =
    tone === "good" ? "text-good" : tone === "critical" ? "text-critical" : "text-ink";

  return (
    <div className="card-surface p-4">
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tracking-tight tnum ${valueTone}`}>{value}</p>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {delta !== undefined && Number.isFinite(delta) && (
          <span
            className={`inline-flex items-center gap-0.5 font-medium tnum ${
              delta > 0 ? "text-good" : delta < 0 ? "text-critical" : "text-ink-3"
            }`}
          >
            <span aria-hidden>{delta > 0 ? "▲" : delta < 0 ? "▼" : "—"}</span>
            {signedPct(delta)}
          </span>
        )}
        {hint && <span className="text-ink-3">{hint}</span>}
      </div>
    </div>
  );
}

/* ── 徽标 ───────────────────────────────────────────── */

type Tone = "good" | "warning" | "serious" | "critical" | "primary" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  good: "tint-good text-good",
  warning: "tint-warning text-ink",
  serious: "tint-serious text-ink",
  critical: "tint-critical text-critical",
  primary: "tint-primary text-primary",
  muted: "bg-sunken text-ink-3",
};

export function Badge({
  children,
  tone = "muted",
  icon,
}: {
  children: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${TONE_CLASS[tone]}`}
    >
      {icon && <span aria-hidden>{icon}</span>}
      {children}
    </span>
  );
}

/** 平台色点：颜色只做辅助，名字才是识别依据 */
export function PlatformDot({ slot }: { slot: number }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ background: `var(--series-${((slot - 1) % 5) + 1})` }}
    />
  );
}

export function PlatformLabel({ name, slot }: { name: string; slot: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <PlatformDot slot={slot} />
      {name}
    </span>
  );
}

/* ── 表格 ───────────────────────────────────────────── */

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      className={`border-b border-line px-3 py-2 text-xs font-medium text-ink-3 text-${align}`}
      style={{ textAlign: align }}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  return (
    <td
      className={`border-b border-line/60 px-3 py-2.5 ${className}`}
      style={{ textAlign: align }}
    >
      {children}
    </td>
  );
}

/* ── 空态 ───────────────────────────────────────────── */

export function EmptyState({
  icon = "◔",
  title,
  hint,
}: {
  icon?: string;
  title: string;
  hint?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <span className="text-2xl text-ink-3" aria-hidden>
        {icon}
      </span>
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {hint && <p className="max-w-sm text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

/* ── 分区标题 ───────────────────────────────────────── */

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
