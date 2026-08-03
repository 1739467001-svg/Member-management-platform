import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { listCustomers } from "@/lib/domain/customers";
import { conversionStats } from "@/lib/domain/reports";
import { TIER_META, TIER_ORDER, type CustomerTier } from "@/lib/constants";
import { formatDate } from "@/lib/date";
import { pct, yuan } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; q?: string; tag?: string }>;
}) {
  const params = await searchParams;
  const tier = params.tier as CustomerTier | undefined;

  const all = await listCustomers();
  const customers = await listCustomers({
    tier,
    search: params.q || undefined,
    tag: params.tag || undefined,
  });
  const conversion = await conversionStats();

  const counts = TIER_ORDER.reduce<Record<string, number>>((acc, t) => {
    acc[t] = all.filter((c) => c.tier === t).length;
    return acc;
  }, {});

  const buildHref = (patch: Record<string, string | undefined>) => {
    const merged = { tier: params.tier, q: params.q, tag: params.tag, ...patch };
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    const qs = sp.toString();
    return qs ? `/customers?${qs}` : "/customers";
  };

  return (
    <div>
      <PageHeader
        title="客户档案"
        subtitle={
          <>
            共 {all.length} 位客户 · 新客转化率{" "}
            <strong className="text-ink">{pct(conversion.rate)}</strong>（
            {conversion.converted}/{conversion.eligible}，满 {conversion.windowDays} 天观察期）
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href={buildHref({ tier: undefined, tag: undefined })}
          className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
            !tier && !params.tag ? "border-primary text-primary" : "border-line text-ink-2 hover:bg-sunken"
          }`}
        >
          全部
        </Link>
        {TIER_ORDER.map((t) => (
          <Link
            key={t}
            href={buildHref({ tier: t, tag: undefined })}
            className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
              tier === t ? "border-primary text-primary" : "border-line text-ink-2 hover:bg-sunken"
            }`}
          >
            {TIER_META[t].icon} {TIER_META[t].label}
            <span className="ml-1 text-ink-3 tnum">{counts[t] ?? 0}</span>
          </Link>
        ))}

        {["流失风险", "已流失", "跨平台", "高频"].map((tag) => (
          <Link
            key={tag}
            href={buildHref({ tag, tier: undefined })}
            className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
              params.tag === tag
                ? "border-primary text-primary"
                : "border-line text-ink-2 hover:bg-sunken"
            }`}
          >
            {tag}
          </Link>
        ))}

        <form action="/customers" className="ml-auto flex gap-1">
          <input
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="搜索姓名 / 备注"
            className="w-40 rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs outline-none focus:border-primary"
          />
          <button
            type="submit"
            className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:bg-sunken"
          >
            搜索
          </button>
        </form>
      </div>

      {tier && (
        <p className="mb-3 rounded-lg tint-primary px-3 py-2 text-xs text-primary">
          <strong>{TIER_META[tier].label}客户建议：</strong>
          {TIER_META[tier].advice}
        </p>
      )}

      <Card>
        {customers.length === 0 ? (
          <EmptyState title="没有符合条件的客户" hint="客户档案会在录入订单时自动建立" />
        ) : (
          <Table minWidth={0}>
            <thead>
              <tr>
                <Th>客户</Th>
                <Th align="right" className="hidden sm:table-cell">
                  评分
                </Th>
                <Th>分层</Th>
                <Th align="right">订单</Th>
                <Th align="right" className="hidden lg:table-cell">
                  续费
                </Th>
                <Th align="right">累计消费</Th>
                <Th className="hidden lg:table-cell">最近下单</Th>
                <Th className="hidden md:table-cell">标签</Th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <Link
                      href={`/customers/${c.id}`}
                      className="font-medium text-ink underline-offset-2 hover:underline"
                    >
                      {c.name}
                    </Link>
                    <p className="text-[11px] text-ink-3">
                      {[c.region, c.device].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </Td>
                  <Td align="right" className="hidden sm:table-cell">
                    <ScoreBar score={c.score} />
                  </Td>
                  <Td>
                    <span className="whitespace-nowrap text-xs text-ink-2">
                      {TIER_META[c.tier].icon} {TIER_META[c.tier].label}
                    </span>
                    <span className="block text-[10px] text-ink-3 tnum sm:hidden">
                      {c.score} 分
                    </span>
                  </Td>
                  <Td align="right" className="tnum">
                    {c.totalOrders}
                    {c.activeOrders > 0 && (
                      <span className="ml-1 text-[10px] text-good">在租{c.activeOrders}</span>
                    )}
                  </Td>
                  <Td align="right" className="hidden tnum text-ink-2 lg:table-cell">
                    {c.renewalCount}
                  </Td>
                  <Td align="right" className="tnum font-medium">
                    {yuan(c.totalRevenue, 0)}
                  </Td>
                  <Td className="hidden tnum text-xs text-ink-3 lg:table-cell">
                    {c.lastOrderAt ? formatDate(c.lastOrderAt) : "—"}
                  </Td>
                  <Td className="hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((tag) => (
                        <Badge
                          key={tag}
                          tone={
                            tag === "已流失"
                              ? "critical"
                              : tag === "流失风险"
                                ? "warning"
                                : tag === "新客"
                                  ? "primary"
                                  : "muted"
                          }
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

/** 评分用条形 + 数字双重表达，不靠颜色深浅传递大小 */
export function ScoreBar({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-sunken">
        <span
          className="block h-full rounded-full bg-primary"
          style={{ width: `${Math.max(3, score)}%` }}
        />
      </span>
      <span className="w-6 text-right text-xs font-medium tnum">{score}</span>
    </span>
  );
}
