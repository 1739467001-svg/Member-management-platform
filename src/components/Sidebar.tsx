"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "数据看板", icon: "◈" },
  { href: "/orders", label: "订单管理", icon: "▤" },
  { href: "/customers", label: "客户档案", icon: "◕" },
  { href: "/costs", label: "成本管理", icon: "▼" },
  { href: "/reports", label: "经营报表", icon: "◳" },
  { href: "/settings", label: "系统设置", icon: "⚙" },
];

export function Sidebar({ expiringCount }: { expiringCount: number }) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      {/* 平板起：左侧固定栏。平板收窄到 w-48，把宽度让给内容 */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-48 flex-col border-r border-line bg-card md:flex lg:w-56">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <span
            aria-hidden
            className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-ink"
          >
            H
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight text-ink">HHStudio</p>
            <p className="text-[11px] text-ink-3">会员管理</p>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 py-2">
          {NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "tint-primary font-medium text-primary"
                    : "text-ink-2 hover:bg-sunken hover:text-ink"
                }`}
              >
                <span aria-hidden className="w-4 text-center text-xs opacity-70">
                  {item.icon}
                </span>
                {item.label}
                {item.href === "/orders" && expiringCount > 0 && (
                  <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-critical px-1.5 text-[10px] font-semibold text-white tnum">
                    {expiringCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* 移动端：底部导航，方便随手查到期 */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-card md:hidden">
        {NAV.slice(0, 5).map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-[10px] ${
                active ? "text-primary" : "text-ink-3"
              }`}
            >
              <span aria-hidden className="text-sm">
                {item.icon}
              </span>
              {item.label.slice(0, 2)}
              {item.href === "/orders" && expiringCount > 0 && (
                <span className="absolute right-[22%] top-1 size-1.5 rounded-full bg-critical" />
              )}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
