import Link from "next/link";
import { Card, EmptyState, PageHeader, PlatformLabel, Table, Td, Th } from "@/components/ui";
import { listOrders } from "@/lib/domain/orders";
import { listAccounts, listPlatforms } from "@/lib/domain/settings";
import { ORDER_STATUS_META, type OrderStatus } from "@/lib/constants";
import { formatDate, remainingLabel } from "@/lib/date";
import { yuan } from "@/lib/format";
import type { OrderView } from "@/lib/domain/types";
import { deleteOrderAction, renewOrderAction, updateOrderAction } from "@/app/actions";

export const dynamic = "force-dynamic";

const STATUS_TABS: Array<{ key: OrderStatus | "all"; label: string }> = [
  { key: "all", label: "全部" },
  { key: "expiring", label: "即将到期" },
  { key: "expiring_soon", label: "3天内" },
  { key: "active", label: "生效中" },
  { key: "expired", label: "已过期" },
];

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; platform?: string; account?: string; q?: string }>;
}) {
  const params = await searchParams;
  const status = (params.status as OrderStatus | "all") || "all";
  const platforms = await listPlatforms();
  const accounts = await listAccounts(true);

  const orders = await listOrders({
    status,
    platformId: params.platform || undefined,
    accountId: params.account || undefined,
    search: params.q || undefined,
  });

  const buildHref = (patch: Record<string, string | undefined>) => {
    const merged = {
      status,
      platform: params.platform,
      account: params.account,
      q: params.q,
      ...patch,
    };
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v && v !== "all") sp.set(k, v);
    }
    const qs = sp.toString();
    return qs ? `/orders?${qs}` : "/orders";
  };

  const total = orders.reduce((s, o) => s + o.price, 0);

  const chip = (activeState: boolean) =>
    `rounded-lg border px-2.5 py-1.5 text-xs transition-colors min-h-9 inline-flex items-center ${
      activeState ? "border-primary text-primary" : "border-line text-ink-2 hover:bg-sunken"
    }`;

  return (
    <div>
      <PageHeader title="订单管理" subtitle={`共 ${orders.length} 条 · 合计 ${yuan(total)}`} />

      {/* 筛选区：窄屏可横向滑动，不挤压内容 */}
      <div className="mb-4 space-y-2">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
          <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-line text-xs">
            {STATUS_TABS.map((tab) => (
              <Link
                key={tab.key}
                href={buildHref({ status: tab.key })}
                className={`inline-flex min-h-9 items-center whitespace-nowrap px-3 transition-colors ${
                  status === tab.key
                    ? "bg-primary font-medium text-primary-ink"
                    : "text-ink-2 hover:bg-sunken"
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </div>

          <Link href={buildHref({ platform: undefined })} className={`shrink-0 ${chip(!params.platform)}`}>
            全部平台
          </Link>
          {platforms.map((p) => (
            <Link
              key={p.id}
              href={buildHref({ platform: p.id })}
              className={`shrink-0 gap-1.5 ${chip(params.platform === p.id)}`}
            >
              <span
                aria-hidden
                className="inline-block size-2 rounded-full"
                style={{ background: `var(--series-${((p.colorSlot - 1) % 5) + 1})` }}
              />
              {p.name}
            </Link>
          ))}
        </div>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
          <Link href={buildHref({ account: undefined })} className={`shrink-0 ${chip(!params.account)}`}>
            全部账号
          </Link>
          {accounts.map((a) => (
            <Link
              key={a.id}
              href={buildHref({ account: a.id })}
              className={`shrink-0 font-mono tnum ${chip(params.account === a.id)}`}
            >
              {a.label}
              {a.active === 0 && <span className="ml-1 font-sans text-ink-3">停</span>}
            </Link>
          ))}

          <form action="/orders" className="ml-auto flex shrink-0 gap-1">
            {status !== "all" && <input type="hidden" name="status" value={status} />}
            {params.platform && <input type="hidden" name="platform" value={params.platform} />}
            {params.account && <input type="hidden" name="account" value={params.account} />}
            <input
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="搜索客户 / 备注 / 地区"
              className="w-40 rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs outline-none focus:border-primary md:w-44"
            />
            <button
              type="submit"
              className="min-h-9 rounded-lg border border-line px-2.5 text-xs text-ink-2 hover:bg-sunken"
            >
              搜索
            </button>
          </form>
        </div>
      </div>

      {orders.length === 0 ? (
        <Card>
          <EmptyState title="没有符合条件的订单" hint="换个筛选条件，或回到看板录入新订单" />
        </Card>
      ) : (
        <>
          {/* 手机：卡片式，避免横向滚动 */}
          <ul className="space-y-2.5 md:hidden">
            {orders.map((o) => (
              <OrderMobileCard key={o.id} order={o} accounts={accounts} />
            ))}
          </ul>

          {/* 平板及以上：表格 */}
          <Card className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>客户</Th>
                  <Th>平台</Th>
                  <Th>账号</Th>
                  <Th align="right">价格</Th>
                  <Th>周期</Th>
                  <Th>剩余</Th>
                  <Th>身份</Th>
                  <Th>设备 / 地区</Th>
                  <Th align="right">操作</Th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const meta = ORDER_STATUS_META[o.status];
                  const priceGap = o.suggestedPrice !== null ? o.price - o.suggestedPrice : null;
                  return (
                    <tr key={o.id} className="align-top">
                      <Td>
                        <Link
                          href={`/customers/${o.customerId}`}
                          className="font-medium text-ink underline-offset-2 hover:underline"
                        >
                          {o.customerName}
                        </Link>
                        {o.note && (
                          <p className="mt-0.5 max-w-[160px] truncate text-[11px] text-ink-3">
                            「{o.note}」
                          </p>
                        )}
                      </Td>
                      <Td>
                        <PlatformLabel name={o.platformName} slot={o.colorSlot} />
                      </Td>
                      <Td>
                        {o.accountLabel ? (
                          <Link
                            href={`/orders?account=${o.accountId}`}
                            className="font-mono text-xs text-ink-2 underline-offset-2 hover:text-primary hover:underline tnum"
                          >
                            {o.accountLabel}
                          </Link>
                        ) : (
                          <span className="text-xs text-ink-3">—</span>
                        )}
                      </Td>
                      <Td align="right" className="tnum">
                        {yuan(o.price, 0)}
                        {priceGap !== null && priceGap !== 0 && (
                          <span
                            className={`ml-1 text-[10px] ${priceGap > 0 ? "text-good" : "text-ink-3"}`}
                            title={`建议价 ${o.suggestedPrice}`}
                          >
                            {priceGap > 0 ? "+" : ""}
                            {priceGap.toFixed(0)}
                          </span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap tnum text-ink-2">
                        {formatDate(o.startDate)} – {formatDate(o.endDate)}
                        <span className="ml-1 text-[11px] text-ink-3">{o.durationDays}天</span>
                      </Td>
                      <Td>
                        <span
                          className={`whitespace-nowrap text-xs font-medium ${
                            meta.tone === "good"
                              ? "text-good"
                              : meta.tone === "muted"
                                ? "text-ink-3"
                                : "text-critical"
                          }`}
                        >
                          {remainingLabel(o.daysLeft)}
                        </span>
                      </Td>
                      <Td className="text-xs text-ink-2">
                        {o.customerType === "returning" ? "老顾客" : "新顾客"}
                      </Td>
                      <Td className="text-xs text-ink-3">
                        {[o.device, o.region].filter(Boolean).join(" · ") || "—"}
                      </Td>
                      <Td align="right">
                        <div className="flex justify-end gap-1">
                          <form action={renewOrderAction}>
                            <input type="hidden" name="id" value={o.id} />
                            <button
                              type="submit"
                              className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 transition-colors hover:border-primary hover:text-primary"
                            >
                              续费
                            </button>
                          </form>
                          <details className="relative">
                            <summary className="cursor-pointer list-none rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-primary hover:text-primary">
                              编辑
                            </summary>
                            <div className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-line bg-card p-3 text-left shadow-[var(--shadow-pop)]">
                              <OrderEditForm order={o} accounts={accounts} />
                            </div>
                          </details>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}

/* ── 手机端卡片 ─────────────────────────────────────── */

function OrderMobileCard({
  order: o,
  accounts,
}: {
  order: OrderView;
  accounts: Array<{ id: string; label: string }>;
}) {
  const meta = ORDER_STATUS_META[o.status];
  return (
    <li className="card-surface p-3.5">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/customers/${o.customerId}`}
            className="font-medium text-ink underline-offset-2 hover:underline"
          >
            {o.customerName}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
            <PlatformLabel name={o.platformName} slot={o.colorSlot} />
            {o.accountLabel && (
              <span className="rounded bg-sunken px-1.5 font-mono text-[11px] tnum">
                {o.accountLabel}
              </span>
            )}
            <span>{o.customerType === "returning" ? "老顾客" : "新顾客"}</span>
          </div>
        </div>
        <span className="shrink-0 text-right">
          <span className="block text-base font-semibold tnum">{yuan(o.price, 0)}</span>
          <span
            className={`text-[11px] font-medium ${
              meta.tone === "good"
                ? "text-good"
                : meta.tone === "muted"
                  ? "text-ink-3"
                  : "text-critical"
            }`}
          >
            {remainingLabel(o.daysLeft)}
          </span>
        </span>
      </div>

      <p className="text-[11px] text-ink-3 tnum">
        {formatDate(o.startDate)} – {formatDate(o.endDate)} · {o.durationDays}天
        {(o.device || o.region) && (
          <span className="font-sans"> · {[o.device, o.region].filter(Boolean).join(" · ")}</span>
        )}
      </p>
      {o.note && <p className="mt-1 text-[11px] text-ink-3">「{o.note}」</p>}

      <div className="mt-3 flex gap-2">
        <form action={renewOrderAction} className="flex-1">
          <input type="hidden" name="id" value={o.id} />
          <button
            type="submit"
            className="w-full rounded-lg bg-primary py-2 text-xs font-medium text-primary-ink"
          >
            续费
          </button>
        </form>
        <details className="flex-1">
          <summary className="cursor-pointer list-none rounded-lg border border-line py-2 text-center text-xs text-ink-2">
            编辑
          </summary>
          <div className="mt-2 rounded-xl border border-line bg-page/60 p-3">
            <OrderEditForm order={o} accounts={accounts} />
          </div>
        </details>
      </div>
    </li>
  );
}

/* ── 编辑表单（手机与桌面共用） ─────────────────────── */

function OrderEditForm({
  order: o,
  accounts,
}: {
  order: OrderView;
  accounts: Array<{ id: string; label: string; active?: number }>;
}) {
  return (
    <>
      <form action={updateOrderAction} className="space-y-2">
        <input type="hidden" name="id" value={o.id} />
        <EditField label="价格" name="price" type="number" defaultValue={o.price} />
        <EditField label="开始日" name="startDate" type="date" defaultValue={o.startDate} />
        <EditField label="有效天数" name="durationDays" type="number" defaultValue={o.durationDays} />
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-ink-3">会员账号</span>
          <select
            name="accountId"
            defaultValue={o.accountId ?? ""}
            className="w-full rounded-md border border-line bg-page px-2 py-1.5 text-xs outline-none focus:border-primary"
          >
            <option value="">未指定</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <EditField label="设备" name="device" defaultValue={o.device} />
        <EditField label="地区" name="region" defaultValue={o.region} />
        <EditField label="备注" name="note" defaultValue={o.note} />
        <button
          type="submit"
          className="w-full rounded-md bg-primary px-2 py-2 text-[11px] font-medium text-primary-ink hover:bg-primary-hover"
        >
          保存修改
        </button>
      </form>
      <form action={deleteOrderAction} className="mt-1.5">
        <input type="hidden" name="id" value={o.id} />
        <button
          type="submit"
          className="w-full rounded-md border border-line px-2 py-2 text-[11px] text-critical hover:bg-sunken"
        >
          删除这条订单
        </button>
      </form>
    </>
  );
}

function EditField({
  label,
  name,
  defaultValue,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue: string | number;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] text-ink-3">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        className="w-full rounded-md border border-line bg-page px-2 py-1.5 text-xs outline-none focus:border-primary tnum"
      />
    </label>
  );
}
