import { Sidebar } from "@/components/Sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getExpiringOrders } from "@/lib/domain/orders";
import { ensureDailyRun } from "@/lib/domain/daily";
import { formatDateFull, today } from "@/lib/date";
import { logoutAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // 兜底：若调度器没跑（比如服务器刚重启），登录时补跑当日任务
  await ensureDailyRun();
  const expiring = getExpiringOrders();

  return (
    <div className="min-h-dvh">
      <Sidebar expiringCount={expiring.length} />

      <div className="md:pl-56">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-line bg-page/85 px-4 backdrop-blur-md md:px-8">
          <div className="flex items-center gap-2 md:hidden">
            <span
              aria-hidden
              className="grid size-7 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-ink"
            >
              H
            </span>
            <span className="text-sm font-semibold text-ink">HHStudio</span>
          </div>

          <p className="hidden text-xs text-ink-3 md:block">
            今天是 {formatDateFull(today())}
          </p>

          <div className="flex items-center gap-1">
            <ThemeToggle />
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-lg px-2.5 py-1.5 text-xs text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
              >
                退出
              </button>
            </form>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 md:px-8 md:pb-12">{children}</main>
      </div>
    </div>
  );
}
