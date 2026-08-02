import Link from "next/link";
import { Card, EmptyState, PageHeader, PlatformLabel, Table, Td, Th } from "@/components/ui";
import { listOrders } from "@/lib/domain/orders";
import { listPlatforms } from "@/lib/domain/settings";
import { ORDER_STATUS_META, type OrderStatus } from "@/lib/constants";
import { formatDate, remainingLabel } from "@/lib/date";
import { yuan } from "@/lib/format";
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
  searchParams: Promise<{ status?: string; platform?: string; q?: string }>;
}) {
  const params = await searchParams;
  const status = (params.status as OrderStatus | "all") || "all";
  const platforms = listPlatforms();

  const orders = listOrders({
    status,
    platformId: params.platform || undefined,
    search: params.q || undefined,
  });

  const buildHref = (patch: Record<string, string | undefined>) => {
    const merged = { status, platform: params.platform, q: params.q, ...patch };
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v && v !== "all") sp.set(k, v);
    }
    const qs = sp.toString();
    return qs ? `/orders?${qs}` : "/orders";
  };

  const total = orders.reduce((s, o) => s + o.price, 0);

  return (
    <div>
      <PageHeader
        title="订单管理"
        subtitle={`共 ${orders.length} 条 · 合计 ${yuan(total)}`}
      />

      {/* 筛选放在一行，紧贴内容上方 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-line text-xs">
          {STATUS_TABS.map((tab) => (
            <Link
              key={tab.key}
              href={buildHref({ status: tab.key })}
              className={`px-3 py-1.5 transition-colors ${
                status === tab.key
                  ? "bg-primary font-medium text-primary-ink"
                  : "text-ink-2 hover:bg-sunken"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>

        <div className="inline-flex flex-wrap gap-1">
          <Link
            href={buildHref({ platform: undefined })}
            className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
              !params.platform
                ? "border-primary text-primary"
                : "border-line text-ink-2 hover:bg-sunken"
            }`}
          >
            全部平台
          </Link>
          {platforms.map((p) => (
            <Link
              key={p.id}
              href={buildHref({ platform: p.id })}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                params.platform === p.id
                  ? "border-primary text-primary"
                  : "border-line text-ink-2 hover:bg-sunken"
              }`}
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

        <form action="/orders" className="ml-auto flex gap-1">
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          {params.platform && <input type="hidden" name="platform" value={params.platform} />}
          <input
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="搜索客户 / 备注 / 地区"
            className="w-44 rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs outline-none focus:border-primary"
          />
          <button
            type="submit"
            className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:bg-sunken"
          >
            搜索
          </button>
        </form>
      </div>

      <Card padded={false}>
        {orders.length === 0 ? (
          <EmptyState title="没有符合条件的订单" hint="换个筛选条件，或回到看板录入新订单" />
        ) : (
          <div className="p-5">
            <Table>
              <thead>
                <tr>
                  <Th>客户</Th>
                  <Th>平台</Th>
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
                  const priceGap =
                    o.suggestedPrice !== null ? o.price - o.suggestedPrice : null;
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
                              <form action={updateOrderAction} className="space-y-2">
                                <input type="hidden" name="id" value={o.id} />
                                <EditField label="价格" name="price" type="number" defaultValue={o.price} />
                                <EditField
                                  label="开始日"
                                  name="startDate"
                                  type="date"
                                  defaultValue={o.startDate}
                                />
                                <EditField
                                  label="有效天数"
                                  name="durationDays"
                                  type="number"
                                  defaultValue={o.durationDays}
                                />
                                <EditField label="设备" name="device" defaultValue={o.device} />
                                <EditField label="地区" name="region" defaultValue={o.region} />
                                <EditField label="备注" name="note" defaultValue={o.note} />
                                <button
                                  type="submit"
                                  className="w-full rounded-md bg-primary px-2 py-1.5 text-[11px] font-medium text-primary-ink hover:bg-primary-hover"
                                >
                                  保存修改
                                </button>
                              </form>
                              <form action={deleteOrderAction} className="mt-1.5">
                                <input type="hidden" name="id" value={o.id} />
                                <button
                                  type="submit"
                                  className="w-full rounded-md border border-line px-2 py-1.5 text-[11px] text-critical hover:bg-sunken"
                                >
                                  删除这条订单
                                </button>
                              </form>
                            </div>
                          </details>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </div>
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
        className="w-full rounded-md border border-line bg-page px-2 py-1 text-xs outline-none focus:border-primary tnum"
      />
    </label>
  );
}
