import Link from "next/link";
import { renewOrderAction } from "@/app/actions";
import { remainingLabel } from "@/lib/date";
import { yuan } from "@/lib/format";
import { TIER_META } from "@/lib/constants";
import type { OrderView } from "@/lib/domain/types";
import { PlatformDot } from "./ui";

/**
 * 到期提醒。剩余 ≤1 天走红色，2–3 天走橙色次级提示。
 * 每行直接给「续费」按钮——提醒的价值在于当场能处理掉。
 */
export function ExpiringAlert({
  urgent,
  warning,
}: {
  urgent: OrderView[];
  warning: OrderView[];
}) {
  if (urgent.length === 0 && warning.length === 0) return null;

  return (
    <div className="space-y-3">
      {urgent.length > 0 && (
        <section className="tint-critical overflow-hidden rounded-[var(--radius-card)] border border-critical/25">
          <header className="flex items-center gap-2 px-5 pt-4">
            <span aria-hidden className="text-critical">
              ⬤
            </span>
            <h2 className="text-sm font-semibold text-critical">
              到期提醒 · {urgent.length} 位客户需要跟进
            </h2>
          </header>
          <ul className="mt-3 divide-y divide-line/50">
            {urgent.map((o) => (
              <ExpiringRow key={o.id} order={o} tone="critical" />
            ))}
          </ul>
        </section>
      )}

      {warning.length > 0 && (
        <section className="tint-warning overflow-hidden rounded-[var(--radius-card)] border border-warning/25">
          <header className="flex items-center gap-2 px-5 pt-4">
            <span aria-hidden className="text-ink-2">
              ◐
            </span>
            <h2 className="text-sm font-semibold text-ink">
              3 天内到期 · {warning.length} 位
            </h2>
          </header>
          <ul className="mt-3 divide-y divide-line/50">
            {warning.map((o) => (
              <ExpiringRow key={o.id} order={o} tone="warning" />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ExpiringRow({ order, tone }: { order: OrderView; tone: "critical" | "warning" }) {
  const tier = TIER_META[order.customerTier];

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
      <Link
        href={`/customers/${order.customerId}`}
        className="text-sm font-medium text-ink underline-offset-2 hover:underline"
      >
        {order.customerName}
      </Link>

      <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
        <PlatformDot slot={order.colorSlot} />
        {order.platformName}
      </span>

      <span
        className={`text-xs font-medium tnum ${tone === "critical" ? "text-critical" : "text-ink-2"}`}
      >
        {remainingLabel(order.daysLeft)}
      </span>

      <span className="text-xs text-ink-3 tnum">
        {order.endDate} · 上次 {yuan(order.price, 0)}
      </span>

      <span className="text-[11px] text-ink-3">
        {tier.icon} {tier.label}
      </span>

      {order.note && (
        <span className="max-w-[220px] truncate text-[11px] text-ink-3" title={order.note}>
          「{order.note}」
        </span>
      )}

      <form action={renewOrderAction} className="ml-auto">
        <input type="hidden" name="id" value={order.id} />
        <button
          type="submit"
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-ink transition-colors hover:bg-primary-hover"
        >
          续费
        </button>
      </form>
    </li>
  );
}
