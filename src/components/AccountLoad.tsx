import Link from "next/link";
import type { AccountLoadRow } from "@/lib/domain/types";
import { EmptyState, PlatformDot } from "./ui";

/**
 * 账号负载：每个会员账号当前带着几位租户，按平台拆开。
 * 这是「一份成本服务多位租户」在运营上的直接体现 ——
 * 想知道某个号还能不能再租、某位客户用的是哪个号，看这里。
 */
export function AccountLoad({ rows }: { rows: AccountLoadRow[] }) {
  const inUse = rows.filter((r) => r.active || r.totalRenters > 0);

  if (inUse.length === 0) {
    return <EmptyState icon="▦" title="还没有账号" hint="到「系统设置 → 会员账号」里添加" />;
  }

  return (
    <ul className="space-y-2.5">
      {inUse.map((row) => (
        <li
          key={row.accountId}
          className="rounded-xl border border-line bg-page/50 p-3"
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Link
              href={`/orders?account=${row.accountId}`}
              className="font-mono text-sm font-semibold text-ink underline-offset-2 hover:underline tnum"
            >
              {row.label}
            </Link>
            {!row.active && (
              <span className="rounded-full bg-sunken px-1.5 py-0.5 text-[10px] text-ink-3">
                已停用
              </span>
            )}
            <span className="ml-auto text-xs text-ink-2 tnum">
              在租 <strong className="text-ink">{row.totalRenters}</strong> 人
            </span>
          </div>

          {row.byPlatform.length === 0 ? (
            <p className="text-[11px] text-ink-3">当前没有租户</p>
          ) : (
            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
              {row.byPlatform.map((p) => (
                <span
                  key={p.platformId}
                  className="inline-flex items-center gap-1.5 text-[11px] text-ink-2"
                >
                  <PlatformDot slot={p.colorSlot} />
                  {p.platformName}
                  <span className="font-medium text-ink tnum">{p.renters}</span>
                </span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
