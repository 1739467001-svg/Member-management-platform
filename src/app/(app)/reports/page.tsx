import Link from "next/link";
import { Card, CardHeader, EmptyState, PageHeader, PlatformLabel, StatTile, Table, Td, Th } from "@/components/ui";
import { ProfitBars, StackedBars, TrendLine } from "@/components/charts";
import { ReportExport } from "@/components/ReportExport";
import {
  conversionStats,
  dailyRevenue,
  lapsedOrders,
  platformTrend,
  previousSummary,
  reportCsv,
  reportMarkdown,
  summaryFor,
  type Granularity,
} from "@/lib/domain/reports";
import { getTopCustomers } from "@/lib/domain/customers";
import { TIER_META } from "@/lib/constants";
import { diffDays, formatDate, remainingLabel, today } from "@/lib/date";
import { pct, signedPct, yuan, yuanCompact } from "@/lib/format";

export const dynamic = "force-dynamic";

const TABS: Array<{ key: Granularity; label: string }> = [
  { key: "week", label: "周报" },
  { key: "month", label: "月报" },
  { key: "year", label: "年报" },
];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ g?: string }>;
}) {
  const params = await searchParams;
  const granularity = (TABS.find((t) => t.key === params.g)?.key ?? "month") as Granularity;

  const summary = summaryFor(granularity);
  const previous = previousSummary(granularity);
  const periodCount = granularity === "week" ? 8 : granularity === "month" ? 6 : 3;
  const stacked = platformTrend(granularity, periodCount);
  const conversion = conversionStats();
  const lapsed = lapsedOrders(8);
  const top = getTopCustomers(5);
  const daily = dailyRevenue(granularity === "week" ? 14 : 30);

  const markdown = reportMarkdown(granularity, summary, previous);
  const csv = reportCsv(summary);

  const delta = (now: number, before: number) =>
    before === 0 ? (now > 0 ? 1 : 0) : (now - before) / Math.abs(before);

  const hasData = summary.orders > 0 || summary.cost > 0;

  const isOngoing = summary.end >= today();
  const elapsedDays = Math.min(
    diffDays(summary.start, today()) + 1,
    diffDays(summary.start, summary.end) + 1,
  );
  const totalDays = diffDays(summary.start, summary.end) + 1;

  return (
    <div>
      <PageHeader
        title="经营报表"
        subtitle={`${summary.label} · ${summary.start} ~ ${summary.end}`}
        action={
          <div className="flex items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-lg border border-line text-xs">
              {TABS.map((t) => (
                <Link
                  key={t.key}
                  href={`/reports?g=${t.key}`}
                  className={`px-3 py-1.5 transition-colors ${
                    granularity === t.key
                      ? "bg-primary font-medium text-primary-ink"
                      : "text-ink-2 hover:bg-sunken"
                  }`}
                >
                  {t.label}
                </Link>
              ))}
            </div>
            <ReportExport
              markdown={markdown}
              csv={csv}
              filename={`HHStudio-${granularity}-${summary.start}`}
            />
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="收入"
          value={yuanCompact(summary.revenue)}
          delta={delta(summary.revenue, previous.revenue)}
          hint="环比"
        />
        <StatTile
          label="成本"
          value={yuanCompact(summary.cost)}
          delta={delta(summary.cost, previous.cost)}
          hint="环比"
        />
        <StatTile
          label="毛利"
          value={yuanCompact(summary.profit)}
          tone={summary.profit >= 0 ? "good" : "critical"}
          delta={delta(summary.profit, previous.profit)}
          hint="环比"
        />
        <StatTile
          label="毛利率"
          value={pct(summary.margin)}
          hint={`上期 ${pct(previous.margin)}`}
        />
      </div>

      {/* 平台明细是这张报表的主角：收入减成本，按平台大类算清楚 */}
      {/* 现金口径下，月初一次性付掉的会员采购成本会让「本期毛利」在月中看起来是负的。
          与其让人误读，不如把进度说清楚。 */}
      {isOngoing && (
        <p className="mb-4 rounded-lg tint-primary px-3 py-2 text-xs text-primary">
          本期进行中 · 第 {elapsedDays}/{totalDays} 天。成本按实际支付日全额计入，
          月初刚续完会员时毛利会先显示为负，随着本期订单陆续录入会回正。
        </p>
      )}

      <Card className="mb-5">
        <CardHeader
          title="平台明细"
          subtitle="一份账号成本可服务多位租户，所以毛利以平台为核算单位"
        />
        {!hasData ? (
          <EmptyState title="本期还没有数据" hint="录入订单与成本后，这里会给出每个平台的盈亏" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>平台</Th>
                <Th align="right">订单数</Th>
                <Th align="right">收入</Th>
                <Th align="right">成本</Th>
                <Th align="right">毛利</Th>
                <Th align="right">毛利率</Th>
              </tr>
            </thead>
            <tbody>
              {summary.platforms.map((p) => (
                <tr key={p.platformId}>
                  <Td>
                    <PlatformLabel name={p.platformName} slot={p.colorSlot} />
                  </Td>
                  <Td align="right" className="tnum text-ink-2">
                    {p.orders}
                  </Td>
                  <Td align="right" className="tnum">
                    {yuan(p.revenue)}
                  </Td>
                  <Td align="right" className="tnum text-ink-2">
                    {yuan(p.cost)}
                  </Td>
                  <Td
                    align="right"
                    className={`tnum font-medium ${p.profit < 0 ? "text-critical" : "text-ink"}`}
                  >
                    {yuan(p.profit)}
                  </Td>
                  <Td align="right" className="tnum text-ink-2">
                    {p.revenue > 0 ? pct(p.margin) : "—"}
                  </Td>
                </tr>
              ))}
              <tr className="font-semibold">
                <Td>合计</Td>
                <Td align="right" className="tnum">
                  {summary.orders}
                </Td>
                <Td align="right" className="tnum">
                  {yuan(summary.revenue)}
                </Td>
                <Td align="right" className="tnum">
                  {yuan(summary.cost)}
                </Td>
                <Td
                  align="right"
                  className={`tnum ${summary.profit < 0 ? "text-critical" : "text-good"}`}
                >
                  {yuan(summary.profit)}
                </Td>
                <Td align="right" className="tnum">
                  {pct(summary.margin)}
                </Td>
              </tr>
            </tbody>
          </Table>
        )}
      </Card>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="各平台收入构成" subtitle={`最近 ${periodCount} 个${TABS.find((t) => t.key === granularity)?.label.replace("报", "")}`} />
          {hasData ? (
            <StackedBars periods={stacked.periods} series={stacked.series} />
          ) : (
            <EmptyState icon="▤" title="暂无数据" />
          )}
        </Card>

        <Card>
          <CardHeader title="本期平台盈亏" subtitle="收入 − 成本" />
          {hasData ? (
            <ProfitBars rows={summary.platforms} />
          ) : (
            <EmptyState icon="▤" title="暂无数据" />
          )}
        </Card>
      </div>

      <Card className="mb-5">
        <CardHeader title="收入趋势" subtitle={`近 ${granularity === "week" ? 14 : 30} 天`} />
        {hasData ? <TrendLine data={daily} /> : <EmptyState title="暂无数据" />}
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="经营洞察" />
          <ul className="space-y-3 text-xs">
            <Insight label="新增客户" value={`${summary.newCustomers} 位`} sub={`上期 ${previous.newCustomers} 位`} />
            <Insight
              label="续费单数"
              value={`${summary.renewals} 单`}
              sub={summary.orders > 0 ? `占比 ${pct(summary.renewals / summary.orders)}` : undefined}
            />
            <Insight
              label="新客转化率"
              value={pct(conversion.rate)}
              sub={`${conversion.converted}/${conversion.eligible} · 观察 ${conversion.windowDays} 天`}
            />
            <Insight
              label="单均价"
              value={summary.orders > 0 ? yuan(summary.revenue / summary.orders) : "—"}
            />
            <Insight
              label="活跃客户"
              value={`${summary.customers} 位`}
              sub={`环比 ${signedPct(delta(summary.customers, previous.customers))}`}
            />
          </ul>
        </Card>

        <Card>
          <CardHeader title="优质客户 TOP 5" subtitle="按综合评分排序" />
          {top.length === 0 ? (
            <EmptyState icon="◕" title="暂无客户" />
          ) : (
            <ol className="space-y-2.5">
              {top.map((c, i) => (
                <li key={c.id} className="flex items-center gap-2.5">
                  <span className="w-4 text-center text-xs text-ink-3 tnum">{i + 1}</span>
                  <Link
                    href={`/customers/${c.id}`}
                    className="text-sm font-medium text-ink underline-offset-2 hover:underline"
                  >
                    {c.name}
                  </Link>
                  <span className="text-[11px] text-ink-3">
                    {TIER_META[c.tier].icon} {TIER_META[c.tier].label}
                  </span>
                  <span className="ml-auto text-xs tnum text-ink-2">
                    {yuan(c.totalRevenue, 0)} · {c.totalOrders}单
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card>
          <CardHeader title="到期未续" subtitle="已过期且没有后续订单，值得回访" />
          {lapsed.length === 0 ? (
            <EmptyState icon="✓" title="没有流失订单" hint="所有到期客户都已续费" />
          ) : (
            <ul className="space-y-2.5">
              {lapsed.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <Link
                    href={`/customers/${o.customerId}`}
                    className="font-medium text-ink underline-offset-2 hover:underline"
                  >
                    {o.customerName}
                  </Link>
                  <PlatformLabel name={o.platformName} slot={o.colorSlot} />
                  <span className="ml-auto text-ink-3 tnum">
                    {formatDate(o.endDate)} · {remainingLabel(o.daysLeft)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Insight({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-line/60 pb-2.5 last:border-0">
      <span className="text-ink-2">{label}</span>
      <span className="text-right">
        <span className="block font-semibold text-ink tnum">{value}</span>
        {sub && <span className="text-[10px] text-ink-3">{sub}</span>}
      </span>
    </li>
  );
}
