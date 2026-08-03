import { Card, CardHeader, EmptyState, PageHeader, PlatformLabel, StatTile, Table, Td, Th } from "@/components/ui";
import { costMatrix, listCosts } from "@/lib/domain/costs";
import { listAccounts, listPlatforms } from "@/lib/domain/settings";
import { summaryFor } from "@/lib/domain/reports";
import { createCostAction, deleteCostAction } from "@/app/actions";
import { formatDate, today } from "@/lib/date";
import { yuan, yuanCompact } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const params = await searchParams;
  const year = Number(params.year) || Number(today().slice(0, 4));

  const platforms = await listPlatforms();
  const accounts = await listAccounts();
  const matrix = await costMatrix(year);
  const recent = await listCosts({ limit: 30 });
  const month = await summaryFor("month");

  return (
    <div>
      <PageHeader
        title="成本管理"
        subtitle="会员采购与续费支出，按平台归集后冲抵收入"
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={`${year} 年累计成本`} value={yuanCompact(matrix.grandTotal)} />
        <StatTile label={`${month.label}成本`} value={yuanCompact(month.cost)} />
        <StatTile label={`${month.label}收入`} value={yuanCompact(month.revenue)} />
        <StatTile
          label={`${month.label}毛利`}
          value={yuanCompact(month.profit)}
          tone={month.profit >= 0 ? "good" : "critical"}
        />
      </div>

      <div className="grid gap-5 [&>*]:min-w-0 lg:grid-cols-[1fr_1.7fr]">
        <Card>
          <CardHeader title="记一笔成本" subtitle="也可以在看板用文字录入：成本 爱奇艺 8.1 30 月卡续费" />
          <form action={createCostAction} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-3">平台</span>
              <select
                name="platformId"
                required
                className="w-full rounded-lg border border-line bg-page px-2.5 py-2 text-xs outline-none focus:border-primary"
              >
                {platforms.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-3">
                会员账号 <span className="text-ink-3">（这笔钱给哪个号续的）</span>
              </span>
              <select
                name="accountId"
                defaultValue=""
                className="w-full rounded-lg border border-line bg-page px-2.5 py-2 text-xs outline-none focus:border-primary"
              >
                <option value="">未指定</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-3">金额（元）</span>
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  required
                  placeholder="30"
                  className="w-full rounded-lg border border-line bg-page px-2.5 py-2 text-xs outline-none focus:border-primary tnum"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-3">发生日期</span>
                <input
                  name="costDate"
                  type="date"
                  required
                  defaultValue={today()}
                  className="w-full rounded-lg border border-line bg-page px-2.5 py-2 text-xs outline-none focus:border-primary tnum"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-3">覆盖天数</span>
                <select
                  name="periodDays"
                  defaultValue="30"
                  className="w-full rounded-lg border border-line bg-page px-2.5 py-2 text-xs outline-none focus:border-primary"
                >
                  <option value="30">月卡 30 天</option>
                  <option value="90">季卡 90 天</option>
                  <option value="365">年卡 365 天</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-3">分类</span>
                <select
                  name="category"
                  defaultValue="membership"
                  className="w-full rounded-lg border border-line bg-page px-2.5 py-2 text-xs outline-none focus:border-primary"
                >
                  <option value="membership">会员采购</option>
                  <option value="other">其他支出</option>
                </select>
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-3">备注</span>
              <input
                name="note"
                placeholder="8月月卡续费"
                className="w-full rounded-lg border border-line bg-page px-2.5 py-2 text-xs outline-none focus:border-primary"
              />
            </label>

            <button
              type="submit"
              className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-ink hover:bg-primary-hover"
            >
              保存成本
            </button>
          </form>
        </Card>

        <Card>
          <CardHeader title={`${year} 年成本矩阵`} subtitle="平台 × 月份，一眼看清每个平台每月投入" />
          {matrix.grandTotal === 0 ? (
            <EmptyState icon="▼" title={`${year} 年还没有成本记录`} hint="在左侧录入第一笔会员采购成本" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>平台</Th>
                  {matrix.months.map((m) => (
                    <Th key={m} align="right">
                      {m}
                    </Th>
                  ))}
                  <Th align="right">合计</Th>
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row) => (
                  <tr key={row.platformId}>
                    <Td>
                      <PlatformLabel name={row.platformName} slot={row.colorSlot} />
                    </Td>
                    {row.values.map((v, i) => (
                      <Td key={i} align="right" className="tnum text-ink-2">
                        {v > 0 ? v.toFixed(0) : "—"}
                      </Td>
                    ))}
                    <Td align="right" className="tnum font-medium">
                      {row.total > 0 ? yuan(row.total, 0) : "—"}
                    </Td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <Td>合计</Td>
                  {matrix.monthTotals.map((v, i) => (
                    <Td key={i} align="right" className="tnum">
                      {v > 0 ? v.toFixed(0) : "—"}
                    </Td>
                  ))}
                  <Td align="right" className="tnum">
                    {yuan(matrix.grandTotal, 0)}
                  </Td>
                </tr>
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="成本明细" subtitle={`最近 ${recent.length} 条`} />
        {recent.length === 0 ? (
          <EmptyState icon="▼" title="暂无成本记录" />
        ) : (
          <Table minWidth={0}>
            <thead>
              <tr>
                <Th>日期</Th>
                <Th>平台</Th>
                <Th>账号</Th>
                <Th align="right">金额</Th>
                <Th className="hidden lg:table-cell">覆盖周期</Th>
                <Th className="hidden lg:table-cell">分类</Th>
                <Th className="hidden md:table-cell">备注</Th>
                <Th align="right">操作</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((c) => (
                <tr key={c.id}>
                  <Td className="tnum text-ink-2">{formatDate(c.costDate)}</Td>
                  <Td>
                    <PlatformLabel name={c.platformName} slot={c.colorSlot} />
                  </Td>
                  <Td className="font-mono text-xs text-ink-2 tnum">{c.accountLabel ?? "—"}</Td>
                  <Td align="right" className="tnum font-medium">
                    {yuan(c.amount)}
                  </Td>
                  <Td className="hidden tnum text-xs text-ink-3 lg:table-cell">
                    {c.periodDays} 天
                  </Td>
                  <Td className="hidden text-xs text-ink-2 lg:table-cell">
                    {c.category === "membership" ? "会员采购" : "其他支出"}
                  </Td>
                  <Td className="hidden text-xs text-ink-3 md:table-cell">{c.note || "—"}</Td>
                  <Td align="right">
                    <form action={deleteCostAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-line px-2 py-1 text-[11px] text-critical hover:bg-sunken"
                      >
                        删除
                      </button>
                    </form>
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
