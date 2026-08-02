"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { parseBatch, type ParsedCost, type ParsedOrder, type PlatformLite } from "@/lib/parser";
import { computeEndDate, daysRemaining, remainingLabel } from "@/lib/date";
import { yuan } from "@/lib/format";
import { TIER_META, type CustomerTier } from "@/lib/constants";
import { lookupCustomerAction, saveEntriesAction } from "@/app/actions";

type Draft =
  | ({ uid: string } & ParsedOrder)
  | ({ uid: string } & ParsedCost);

type Lookup = Awaited<ReturnType<typeof lookupCustomerAction>>;

const EXAMPLE = "小陈 爱奇艺 2026.8.02 13 老顾客（一直很守时） iphone17 浙江杭州";

let uidSeq = 0;
const nextUid = () => `d${uidSeq++}`;

/* ── 小组件 ─────────────────────────────────────────── */

function Field({
  label,
  children,
  missing,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  missing?: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      <span
        className={`mb-1 flex items-center gap-1 text-[10px] font-medium ${
          missing ? "text-critical" : "text-ink-3"
        }`}
      >
        {label}
        {missing && <span aria-hidden>•必填</span>}
        {hint && <span className="font-normal text-ink-3">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border bg-page px-2 py-1.5 text-xs text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-primary";

function TextInput({
  value,
  onChange,
  missing,
  placeholder,
  type = "text",
}: {
  value: string | number;
  onChange: (v: string) => void;
  missing?: boolean;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputCls} tnum ${missing ? "border-critical" : "border-line"}`}
    />
  );
}

/* ── 主体 ───────────────────────────────────────────── */

export function QuickEntry({ platforms }: { platforms: Array<PlatformLite & { colorSlot: number }> }) {
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [lookups, setLookups] = useState<Record<string, Lookup>>({});
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const parseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const platformLite = useMemo<PlatformLite[]>(
    () => platforms.map((p) => ({ id: p.id, name: p.name, aliases: p.aliases })),
    [platforms],
  );

  // 输入停顿 250ms 再解析，边打字边重建卡片会很跳
  useEffect(() => {
    if (parseTimer.current) clearTimeout(parseTimer.current);
    if (!text.trim()) {
      setDrafts([]);
      return;
    }
    parseTimer.current = setTimeout(() => {
      setDrafts(parseBatch(text, platformLite).map((d) => ({ ...d, uid: nextUid() })));
      setMessage(null);
    }, 250);
    return () => {
      if (parseTimer.current) clearTimeout(parseTimer.current);
    };
  }, [text, platformLite]);

  // 客户身份回显：拿到姓名 + 平台就去查历史
  useEffect(() => {
    for (const d of drafts) {
      if (d.kind !== "order" || !d.customerName || !d.platformId) continue;
      const key = `${d.customerName}|${d.platformId}`;
      if (lookups[key] !== undefined) continue;

      setLookups((prev) => ({ ...prev, [key]: null }));
      lookupCustomerAction(d.customerName, d.platformId).then((res) =>
        setLookups((prev) => ({ ...prev, [key]: res })),
      );
    }
    // lookups 故意不进依赖：它只用来去重，变化不该触发重查
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts]);

  const patch = (uid: string, changes: Record<string, unknown>) => {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.uid !== uid) return d;
        const merged = { ...d, ...changes } as Draft;
        if (merged.kind === "order") {
          merged.endDate = computeEndDate(merged.startDate ?? "", merged.durationDays);
          merged.missing = [
            !merged.customerName?.trim() && "customerName",
            !merged.platformId && "platformId",
            !Number.isFinite(merged.price as number) && "price",
          ].filter(Boolean) as string[];
        } else {
          merged.missing = [
            !merged.platformId && "platformId",
            !Number.isFinite(merged.amount as number) && "amount",
          ].filter(Boolean) as string[];
        }
        return merged;
      }),
    );
  };

  const remove = (uid: string) => setDrafts((prev) => prev.filter((d) => d.uid !== uid));

  const blocked = drafts.some((d) => d.missing.length > 0);

  const save = () => {
    if (blocked || drafts.length === 0) return;
    startTransition(async () => {
      const orders = drafts
        .filter((d): d is { uid: string } & ParsedOrder => d.kind === "order")
        .map((d) => {
          const key = `${d.customerName}|${d.platformId}`;
          return {
            customerName: d.customerName!,
            customerId: lookups[key]?.customerId ?? null,
            platformId: d.platformId!,
            price: d.price!,
            startDate: d.startDate!,
            durationDays: d.durationDays,
            durationType: d.durationType,
            customerType: d.customerType,
            device: d.device,
            region: d.region,
            note: d.note,
            rawText: d.raw,
          };
        });

      const costs = drafts
        .filter((d): d is { uid: string } & ParsedCost => d.kind === "cost")
        .map((d) => ({
          platformId: d.platformId!,
          amount: d.amount!,
          costDate: d.costDate!,
          periodDays: d.periodDays,
          note: d.note,
          rawText: d.raw,
        }));

      const res = await saveEntriesAction({ orders, costs });
      if (res.ok) {
        setText("");
        setDrafts([]);
        setLookups({});
        setMessage({
          tone: "ok",
          text: `已保存 ${res.orders} 条订单${res.costs ? ` · ${res.costs} 条成本` : ""}`,
        });
      } else {
        setMessage({ tone: "err", text: res.error });
      }
    });
  };

  return (
    <section className="card-surface p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">快速录入</h2>
        <p className="text-[11px] text-ink-3">
          一行一条，顺序随意 · 含「成本 / 花费」的行自动识别为成本
        </p>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={drafts.length ? 3 : 2}
        spellCheck={false}
        placeholder={`${EXAMPLE}\n成本 爱奇艺 2026.8.1 30 月卡续费`}
        className="w-full resize-y rounded-xl border border-line bg-page px-3.5 py-3 text-sm leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-primary"
      />

      {!text && (
        <button
          type="button"
          onClick={() => setText(EXAMPLE)}
          className="mt-2 text-[11px] text-primary underline-offset-2 hover:underline"
        >
          填入示例试试
        </button>
      )}

      {message && (
        <p
          role="status"
          className={`mt-3 rounded-lg px-3 py-2 text-xs ${
            message.tone === "ok" ? "tint-good text-good" : "tint-critical text-critical"
          }`}
        >
          {message.text}
        </p>
      )}

      {drafts.length > 0 && (
        <>
          <div className="mt-4 space-y-3">
            {drafts.map((d) =>
              d.kind === "order" ? (
                <OrderCard
                  key={d.uid}
                  draft={d}
                  platforms={platforms}
                  lookup={lookups[`${d.customerName}|${d.platformId}`] ?? null}
                  onPatch={(c) => patch(d.uid, c)}
                  onRemove={() => remove(d.uid)}
                />
              ) : (
                <CostCard
                  key={d.uid}
                  draft={d}
                  platforms={platforms}
                  onPatch={(c) => patch(d.uid, c)}
                  onRemove={() => remove(d.uid)}
                />
              ),
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[11px] text-ink-3">
              {blocked ? "请先补全标红的必填项" : `${drafts.length} 条待保存`}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setText("");
                  setDrafts([]);
                }}
                className="rounded-lg border border-line px-3 py-2 text-xs text-ink-2 transition-colors hover:bg-sunken"
              >
                清空
              </button>
              <button
                type="button"
                onClick={save}
                disabled={blocked || pending}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-ink transition-colors hover:bg-primary-hover disabled:opacity-50"
              >
                {pending ? "保存中…" : "确认保存"}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/* ── 订单确认卡 ─────────────────────────────────────── */

function OrderCard({
  draft,
  platforms,
  lookup,
  onPatch,
  onRemove,
}: {
  draft: { uid: string } & ParsedOrder;
  platforms: Array<PlatformLite & { colorSlot: number }>;
  lookup: Lookup;
  onPatch: (changes: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const has = (f: string) => draft.missing.includes(f);
  const left = draft.endDate ? daysRemaining(draft.endDate) : null;
  const slot = platforms.find((p) => p.id === draft.platformId)?.colorSlot ?? 1;

  const effectiveType = draft.customerType ?? lookup?.type ?? "new";
  const suggested = lookup?.suggestedPrice ?? null;
  const gap = suggested !== null && draft.price !== null ? draft.price - suggested : null;

  return (
    <article className="rounded-xl border border-line bg-page/60 p-3.5 animate-rise">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="tint-primary rounded-full px-2 py-0.5 text-[10px] font-medium text-primary">
          订单
        </span>

        {draft.platformId && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
            <span
              aria-hidden
              className="inline-block size-2 rounded-full"
              style={{ background: `var(--series-${((slot - 1) % 5) + 1})` }}
            />
            {platforms.find((p) => p.id === draft.platformId)?.name}
          </span>
        )}

        {lookup?.exists ? (
          <span className="tint-good rounded-full px-2 py-0.5 text-[10px] text-good">
            {TIER_META[(lookup.tier as CustomerTier) ?? "normal"]?.icon}{" "}
            {lookup.type === "returning" ? "老客户" : "已有档案"} · 该平台第{" "}
            {lookup.platformOrders + 1} 单 · 累计 {yuan(lookup.totalRevenue, 0)}
          </span>
        ) : draft.customerName ? (
          <span className="tint-warning rounded-full px-2 py-0.5 text-[10px] text-ink">
            ✦ 新客户 · 系统里还没有 TA 的记录
          </span>
        ) : null}

        {left !== null && (
          <span className="text-[10px] text-ink-3 tnum">
            {draft.endDate} 到期 · {remainingLabel(left)}
          </span>
        )}

        <button
          type="button"
          onClick={onRemove}
          aria-label="移除这条"
          className="ml-auto rounded px-1.5 text-ink-3 transition-colors hover:text-critical"
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
        <Field label="客户" missing={has("customerName")}>
          <TextInput
            value={draft.customerName ?? ""}
            missing={has("customerName")}
            placeholder="姓名"
            onChange={(v) => onPatch({ customerName: v })}
          />
        </Field>

        <Field label="平台" missing={has("platformId")}>
          <select
            value={draft.platformId ?? ""}
            onChange={(e) => onPatch({ platformId: e.target.value })}
            className={`${inputCls} ${has("platformId") ? "border-critical" : "border-line"}`}
          >
            <option value="">选择…</option>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="价格"
          missing={has("price")}
          hint={
            gap !== null && gap !== 0
              ? `建议${suggested}·${gap > 0 ? "+" : ""}${gap.toFixed(0)}`
              : suggested !== null
                ? `建议${suggested}`
                : undefined
          }
        >
          <TextInput
            type="number"
            value={draft.price ?? ""}
            missing={has("price")}
            placeholder="元"
            onChange={(v) => onPatch({ price: v === "" ? null : Number(v) })}
          />
        </Field>

        <Field
          label="开始日"
          hint={draft.inferred.includes("startDate") ? "默认今天" : undefined}
        >
          <TextInput
            type="date"
            value={draft.startDate ?? ""}
            onChange={(v) => onPatch({ startDate: v })}
          />
        </Field>

        <Field label="有效天数" hint={draft.durationType === "custom" ? "自定义" : undefined}>
          <TextInput
            type="number"
            value={draft.durationDays}
            onChange={(v) =>
              onPatch({ durationDays: Number(v) || 30, durationType: "custom" })
            }
          />
        </Field>

        <Field label="身份">
          <select
            value={effectiveType}
            onChange={(e) => onPatch({ customerType: e.target.value })}
            className={`${inputCls} border-line`}
          >
            <option value="new">新顾客</option>
            <option value="returning">老顾客</option>
          </select>
        </Field>

        <Field label="设备">
          <TextInput
            value={draft.device}
            placeholder="iPhone17"
            onChange={(v) => onPatch({ device: v })}
          />
        </Field>

        <Field label="地区">
          <TextInput
            value={draft.region}
            placeholder="浙江杭州"
            onChange={(v) => onPatch({ region: v })}
          />
        </Field>

        <div className="col-span-2 sm:col-span-4 lg:col-span-4">
          <Field label="备注">
            <TextInput
              value={draft.note}
              placeholder="老顾客、朋友介绍…"
              onChange={(v) => onPatch({ note: v })}
            />
          </Field>
        </div>
      </div>
    </article>
  );
}

/* ── 成本确认卡 ─────────────────────────────────────── */

function CostCard({
  draft,
  platforms,
  onPatch,
  onRemove,
}: {
  draft: { uid: string } & ParsedCost;
  platforms: Array<PlatformLite & { colorSlot: number }>;
  onPatch: (changes: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const has = (f: string) => draft.missing.includes(f);

  return (
    <article className="rounded-xl border border-line bg-page/60 p-3.5 animate-rise">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="tint-serious rounded-full px-2 py-0.5 text-[10px] font-medium text-ink">
          成本
        </span>
        <span className="text-[10px] text-ink-3">这条会计入平台成本，冲抵收入</span>
        <button
          type="button"
          onClick={onRemove}
          aria-label="移除这条"
          className="ml-auto rounded px-1.5 text-ink-3 transition-colors hover:text-critical"
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Field label="平台" missing={has("platformId")}>
          <select
            value={draft.platformId ?? ""}
            onChange={(e) => onPatch({ platformId: e.target.value })}
            className={`${inputCls} ${has("platformId") ? "border-critical" : "border-line"}`}
          >
            <option value="">选择…</option>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="金额" missing={has("amount")}>
          <TextInput
            type="number"
            value={draft.amount ?? ""}
            missing={has("amount")}
            placeholder="元"
            onChange={(v) => onPatch({ amount: v === "" ? null : Number(v) })}
          />
        </Field>

        <Field label="发生日期">
          <TextInput
            type="date"
            value={draft.costDate ?? ""}
            onChange={(v) => onPatch({ costDate: v })}
          />
        </Field>

        <Field label="覆盖天数">
          <TextInput
            type="number"
            value={draft.periodDays}
            onChange={(v) => onPatch({ periodDays: Number(v) || 30 })}
          />
        </Field>

        <div className="col-span-2 sm:col-span-4">
          <Field label="备注">
            <TextInput
              value={draft.note}
              placeholder="8月月卡续费"
              onChange={(v) => onPatch({ note: v })}
            />
          </Field>
        </div>
      </div>
    </article>
  );
}
