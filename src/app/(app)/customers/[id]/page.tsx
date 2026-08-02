import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, PageHeader, PlatformLabel, StatTile, Table, Td, Th } from "@/components/ui";
import { ScoreBar } from "../page";
import { getCustomer } from "@/lib/domain/customers";
import { listOrders } from "@/lib/domain/orders";
import { TIER_META, SCORE_WEIGHTS } from "@/lib/constants";
import { formatDate, remainingLabel } from "@/lib/date";
import { yuan } from "@/lib/format";
import { updateCustomerNoteAction, renewOrderAction } from "@/app/actions";
import { ORDER_STATUS_META } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customer = getCustomer(id);
  if (!customer) notFound();

  const orders = listOrders({ customerId: id });
  const tier = TIER_META[customer.tier];
  const avgPrice = customer.totalOrders > 0 ? customer.totalRevenue / customer.totalOrders : 0;

  return (
    <div>
      <Link href="/customers" className="mb-3 inline-block text-xs text-ink-3 hover:text-ink">
        ← 返回客户列表
      </Link>

      <PageHeader
        title={customer.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>
              {tier.icon} {tier.label}客户
            </span>
            <span className="text-ink-3">·</span>
            <span>{[customer.region, customer.device].filter(Boolean).join(" · ") || "未记录地区"}</span>
            {customer.tags.map((t) => (
              <Badge
                key={t}
                tone={t === "已流失" ? "critical" : t === "流失风险" ? "warning" : "muted"}
              >
                {t}
              </Badge>
            ))}
          </span>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="优质度评分" value={customer.score} hint={`满分 100`} />
        <StatTile label="累计消费" value={yuan(customer.totalRevenue, 0)} />
        <StatTile label="订单总数" value={customer.totalOrders} hint={`在租 ${customer.activeOrders}`} />
        <StatTile label="续费次数" value={customer.renewalCount} />
        <StatTile label="单均价" value={yuan(avgPrice, 1)} hint={`${customer.platformCount} 个平台`} />
      </div>

      <div className="grid gap-5 [&>*]:min-w-0 lg:grid-cols-[1fr_1.6fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="评分构成" subtitle="五个维度加权得出，权重可在代码中调整" />
            <ul className="space-y-2.5 text-xs">
              {[
                { label: "累计消费金额", weight: SCORE_WEIGHTS.revenue },
                { label: "续费次数", weight: SCORE_WEIGHTS.renewal },
                { label: "连续在租时长", weight: SCORE_WEIGHTS.tenure },
                { label: "按时续费率", weight: SCORE_WEIGHTS.punctual },
                { label: "跨平台订阅", weight: SCORE_WEIGHTS.crossPlatform },
              ].map((d) => (
                <li key={d.label} className="flex items-center justify-between gap-3">
                  <span className="text-ink-2">{d.label}</span>
                  <span className="text-ink-3 tnum">权重 {d.weight}%</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 border-t border-line pt-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-ink-2">综合评分</span>
                <ScoreBar score={customer.score} />
              </div>
              <p className="mt-2 rounded-lg tint-primary px-2.5 py-2 text-[11px] text-primary">
                <strong>运营建议：</strong>
                {tier.advice}
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="备注" subtitle="随手记录，系统会据此帮你识别优质客户" />
            <form action={updateCustomerNoteAction} className="space-y-2">
              <input type="hidden" name="id" value={customer.id} />
              <textarea
                name="note"
                rows={4}
                defaultValue={customer.note}
                placeholder="例：一直很守时，介绍过 2 个朋友…"
                className="w-full resize-y rounded-lg border border-line bg-page px-3 py-2 text-xs outline-none focus:border-primary"
              />
              <button
                type="submit"
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-ink hover:bg-primary-hover"
              >
                保存备注
              </button>
            </form>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="订单时间轴"
            subtitle={`首单 ${customer.firstOrderAt ? formatDate(customer.firstOrderAt) : "—"} · 末单 ${
              customer.lastOrderAt ? formatDate(customer.lastOrderAt) : "—"
            }`}
          />
          <Table minWidth={0}>
            <thead>
              <tr>
                <Th>平台</Th>
                <Th align="right">价格</Th>
                <Th className="hidden sm:table-cell">周期</Th>
                <Th>状态</Th>
                <Th className="hidden lg:table-cell">身份</Th>
                <Th align="right">操作</Th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const meta = ORDER_STATUS_META[o.status];
                return (
                  <tr key={o.id}>
                    <Td>
                      <PlatformLabel name={o.platformName} slot={o.colorSlot} />
                    </Td>
                    <Td align="right" className="tnum">
                      {yuan(o.price, 0)}
                    </Td>
                    <Td className="hidden whitespace-nowrap tnum text-xs text-ink-2 sm:table-cell">
                      {formatDate(o.startDate)} – {formatDate(o.endDate)}
                    </Td>
                    <Td>
                      <span
                        className={`whitespace-nowrap text-xs ${
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
                    <Td className="hidden text-xs text-ink-2 lg:table-cell">
                      {o.customerType === "returning" ? "老顾客" : "新顾客"}
                      {o.renewedFromId && <span className="ml-1 text-[10px] text-ink-3">续</span>}
                    </Td>
                    <Td align="right">
                      <form action={renewOrderAction}>
                        <input type="hidden" name="id" value={o.id} />
                        <button
                          type="submit"
                          className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-primary hover:text-primary"
                        >
                          续费
                        </button>
                      </form>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
