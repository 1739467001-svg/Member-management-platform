import { Card, CardHeader, PageHeader, PlatformLabel, Table, Td, Th } from "@/components/ui";
import { PasswordForm } from "./PasswordForm";
import { getPriceTable, getSetting, listPlatforms } from "@/lib/domain/settings";
import { savePlatformAction, savePricesAction, runDailyAction } from "@/app/actions";
import { ALERT_THRESHOLD_DAYS, WARN_THRESHOLD_DAYS } from "@/lib/constants";
import { TZ, today } from "@/lib/date";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const prices = getPriceTable();
  const platforms = listPlatforms(true);
  const lastRun = getSetting("lastDailyRun");

  return (
    <div>
      <PageHeader title="系统设置" subtitle="定价策略、平台别名、账号安全与每日任务" />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="定价规则"
            subtitle="新客首月原价吸引，老客续费降价留存 —— 录入订单时会自动带出建议价"
          />
          <form action={savePricesAction}>
            <Table>
              <thead>
                <tr>
                  <Th>平台</Th>
                  <Th align="right">新客首月</Th>
                  <Th align="right">老客续费</Th>
                  <Th align="right">让利</Th>
                </tr>
              </thead>
              <tbody>
                {prices.map((p) => (
                  <tr key={p.platformId}>
                    <Td>
                      <PlatformLabel name={p.platformName} slot={p.colorSlot} />
                    </Td>
                    <Td align="right">
                      <PriceInput name={`price:${p.platformId}:new`} value={p.newPrice} />
                    </Td>
                    <Td align="right">
                      <PriceInput
                        name={`price:${p.platformId}:returning`}
                        value={p.returningPrice}
                      />
                    </Td>
                    <Td align="right" className="tnum text-xs text-ink-3">
                      {p.newPrice > 0
                        ? `−${(p.newPrice - p.returningPrice).toFixed(0)} 元`
                        : "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <button
              type="submit"
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-ink hover:bg-primary-hover"
            >
              保存定价
            </button>
          </form>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="平台与解析别名"
              subtitle="别名用逗号分隔，录入文字时命中任一别名即可识别该平台"
            />
            <div className="space-y-2.5">
              {platforms.map((p) => (
                <form key={p.id} action={savePlatformAction} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={p.id} />
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: `var(--series-${((p.colorSlot - 1) % 5) + 1})` }}
                  />
                  <input
                    name="name"
                    defaultValue={p.name}
                    className="w-24 shrink-0 rounded-md border border-line bg-page px-2 py-1.5 text-xs outline-none focus:border-primary"
                  />
                  <input
                    name="aliases"
                    defaultValue={p.aliases}
                    className="min-w-0 flex-1 rounded-md border border-line bg-page px-2 py-1.5 text-[11px] outline-none focus:border-primary"
                  />
                  <button
                    type="submit"
                    className="shrink-0 rounded-md border border-line px-2 py-1.5 text-[11px] text-ink-2 hover:border-primary hover:text-primary"
                  >
                    保存
                  </button>
                </form>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="修改密码" />
            <PasswordForm />
          </Card>

          <Card>
            <CardHeader title="系统状态" />
            <dl className="space-y-2 text-xs">
              <Row label="业务时区" value={TZ} />
              <Row label="今天" value={today()} />
              <Row
                label="到期提醒阈值"
                value={`剩余 ≤ ${ALERT_THRESHOLD_DAYS} 天触发红色，≤ ${WARN_THRESHOLD_DAYS} 天橙色预警`}
              />
              <Row label="每日任务上次执行" value={lastRun ?? "尚未执行"} />
            </dl>
            <p className="mt-3 text-[11px] text-ink-3">
              订单剩余天数是查询时实时计算的，即使某天定时任务没跑，页面数据依然准确。
              每日任务只负责重算客户评分、写入统计快照和备份数据库。
            </p>
            <form action={runDailyAction} className="mt-3">
              <button
                type="submit"
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-primary hover:text-primary"
              >
                立即执行每日任务
              </button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}

function PriceInput({ name, value }: { name: string; value: number }) {
  return (
    <input
      name={name}
      type="number"
      step="0.5"
      min="0"
      defaultValue={value}
      className="w-20 rounded-md border border-line bg-page px-2 py-1 text-right text-xs outline-none focus:border-primary tnum"
    />
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 pb-2 last:border-0">
      <dt className="shrink-0 text-ink-2">{label}</dt>
      <dd className="text-right text-ink-3 tnum">{value}</dd>
    </div>
  );
}
