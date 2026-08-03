import Link from "next/link";
import { QuickEntry } from "@/components/QuickEntry";
import { ExpiringAlert } from "@/components/ExpiringAlert";
import { ProfitBars, TrendLine } from "@/components/charts";
import { Card, CardHeader, EmptyState, PlatformLabel, StatTile, Table, Td, Th } from "@/components/ui";
import { AccountLoad } from "@/components/AccountLoad";
import { platformsForParser, listPlatforms, accountsForParser } from "@/lib/domain/settings";
import { getExpiringOrders, getWarningOrders, listOrders } from "@/lib/domain/orders";
import { accountLoad, dailyRevenue, dashboardKpis, summaryFor } from "@/lib/domain/reports";
import { formatDate, remainingLabel } from "@/lib/date";
import { pct, yuan, yuanCompact } from "@/lib/format";
import { ORDER_STATUS_META } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const platforms = await platformsForParser();
  const platformMeta = await listPlatforms();
  const withSlots = platforms.map((p) => ({
    ...p,
    colorSlot: platformMeta.find((m) => m.id === p.id)?.colorSlot ?? 1,
  }));
  const accounts = await accountsForParser();
  const load = await accountLoad();

  const kpi = await dashboardKpis();
  const month = await summaryFor("month");
  const urgent = await getExpiringOrders();
  const warning = await getWarningOrders();
  const recent = await listOrders({ limit: 8 });
  const trend = await dailyRevenue(30);

  const hasData = recent.length > 0;

  return (
    <div className="space-y-5">
      <QuickEntry platforms={withSlots} accounts={accounts} />

      <ExpiringAlert urgent={urgent} warning={warning} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile
          label={`${kpi.monthLabel}收入`}
          value={yuanCompact(kpi.revenue)}
          delta={kpi.revenueDelta}
          hint="较上月"
        />
        <StatTile
          label={`${kpi.monthLabel}成本`}
          value={yuanCompact(kpi.cost)}
          delta={kpi.costDelta}
          hint="较上月"
        />
        <StatTile
          label={`${kpi.monthLabel}毛利`}
          value={yuanCompact(kpi.profit)}
          tone={kpi.profit >= 0 ? "good" : "critical"}
          hint={`毛利率 ${pct(kpi.margin)}`}
        />
        <StatTile label="在租订单" value={kpi.activeOrders} hint={`${kpi.activeCustomers} 位客户`} />
        <StatTile
          label="即将到期"
          value={kpi.expiringCount}
          tone={kpi.expiringCount > 0 ? "critical" : "default"}
          hint="1 天内"
        />
      </div>

      <div className="grid gap-5 [&>*]:min-w-0 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            title="近 30 天收入"
            subtitle="按订单开始日计入，鼠标悬停查看每日明细"
          />
          {hasData ? (
            <TrendLine data={trend} />
          ) : (
            <EmptyState title="还没有订单数据" hint="在上方录入第一笔订单后，这里会显示收入趋势" />
          )}
        </Card>

        <Card>
          <CardHeader
            title="本月各平台盈亏"
            subtitle="收入 − 成本，按平台核算。月初刚续完会员时会先显示为负，属正常"
          />
          {month.platforms.some((p) => p.revenue > 0 || p.cost > 0) ? (
            <ProfitBars rows={month.platforms} />
          ) : (
            <EmptyState
              icon="▤"
              title="本月暂无收支"
              hint="录入订单与成本后，这里按平台展示毛利"
            />
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="账号负载"
          subtitle="每个会员账号当前带着几位租户，点账号号码可查看它名下的全部订单"
        />
        <AccountLoad rows={load} />
      </Card>

      <Card>
        <CardHeader
          title="最近订单"
          action={
            <Link href="/orders" className="text-xs text-primary hover:underline">
              查看全部 →
            </Link>
          }
        />
        {recent.length === 0 ? (
          <EmptyState
            title="暂无订单"
            hint={`试试在上方输入：小陈 爱奇艺 ${new Date().getFullYear()}.8.02 13 老顾客 iphone17 浙江杭州`}
          />
        ) : (
          <Table minWidth={0}>
            <thead>
              <tr>
                <Th>客户</Th>
                <Th>平台</Th>
                <Th align="right">价格</Th>
                <Th className="hidden md:table-cell">周期</Th>
                <Th>状态</Th>
                <Th className="hidden lg:table-cell">设备 / 地区</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((o) => {
                const meta = ORDER_STATUS_META[o.status];
                return (
                  <tr key={o.id}>
                    <Td>
                      <Link
                        href={`/customers/${o.customerId}`}
                        className="font-medium text-ink underline-offset-2 hover:underline"
                      >
                        {o.customerName}
                      </Link>
                    </Td>
                    <Td>
                      <PlatformLabel name={o.platformName} slot={o.colorSlot} />
                    </Td>
                    <Td align="right" className="tnum">
                      {yuan(o.price, 0)}
                    </Td>
                    <Td className="hidden whitespace-nowrap tnum text-ink-2 md:table-cell">
                      {formatDate(o.startDate)} – {formatDate(o.endDate)}
                    </Td>
                    <Td>
                      <span
                        className={`text-xs font-medium ${
                          meta.tone === "good"
                            ? "text-good"
                            : meta.tone === "critical" || meta.tone === "serious"
                              ? "text-critical"
                              : "text-ink-2"
                        }`}
                      >
                        {meta.label}
                        <span className="ml-1 text-ink-3">· {remainingLabel(o.daysLeft)}</span>
                      </span>
                    </Td>
                    <Td className="hidden text-xs text-ink-3 lg:table-cell">
                      {[o.device, o.region].filter(Boolean).join(" · ") || "—"}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
