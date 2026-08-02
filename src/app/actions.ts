"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_MAX_AGE, createSessionToken } from "@/lib/auth/session";
import { checkPassword, changePassword, setPrice, updatePlatform } from "@/lib/domain/settings";
import {
  createOrder,
  deleteOrder,
  findCustomerByName,
  getSuggestedPrice,
  renewOrder,
  resolveCustomerType,
  updateOrder,
  type CreateOrderInput,
} from "@/lib/domain/orders";
import { createCost, deleteCost } from "@/lib/domain/costs";
import { updateCustomerNote } from "@/lib/domain/customers";
import { runDailyTasks } from "@/lib/domain/daily";

function refreshAll() {
  for (const path of ["/", "/orders", "/customers", "/costs", "/reports"]) {
    revalidatePath(path);
  }
}

/* ── 登录 ───────────────────────────────────────────── */

export async function loginAction(_prev: unknown, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (!password) return { error: "请输入密码" };
  if (!checkPassword(password)) return { error: "密码不正确" };

  const jar = await cookies();
  jar.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect("/");
}

export async function logoutAction() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

/* ── 录入 ───────────────────────────────────────────── */

export type DraftOrder = {
  customerName: string;
  customerId?: string | null;
  platformId: string;
  price: number;
  startDate: string;
  durationDays: number;
  durationType?: string;
  customerType?: "new" | "returning" | null;
  device?: string;
  region?: string;
  note?: string;
  rawText?: string;
};

export type DraftCost = {
  platformId: string;
  amount: number;
  costDate: string;
  periodDays?: number;
  category?: string;
  note?: string;
  rawText?: string;
};

/** 批量保存确认卡片里的记录（订单与成本可混在一次提交里） */
export async function saveEntriesAction(payload: {
  orders: DraftOrder[];
  costs: DraftCost[];
}): Promise<{ ok: true; orders: number; costs: number } | { ok: false; error: string }> {
  try {
    for (const o of payload.orders) {
      if (!o.customerName?.trim()) return { ok: false, error: "客户名不能为空" };
      if (!o.platformId) return { ok: false, error: "请选择平台" };
      if (!Number.isFinite(o.price)) return { ok: false, error: "价格必须是数字" };
      createOrder(o as CreateOrderInput);
    }
    for (const c of payload.costs) {
      if (!c.platformId) return { ok: false, error: "请选择平台" };
      if (!Number.isFinite(c.amount)) return { ok: false, error: "金额必须是数字" };
      createCost(c);
    }
    refreshAll();
    return { ok: true, orders: payload.orders.length, costs: payload.costs.length };
  } catch (error) {
    console.error("[saveEntries]", error);
    return { ok: false, error: "保存失败，请重试" };
  }
}

/**
 * 录入时实时回显客户身份：是不是老客、该平台第几单、建议价多少。
 * 让「第二个月降价」这件事在下单当下就看得见，而不是事后补救。
 */
export async function lookupCustomerAction(name: string, platformId: string) {
  const trimmed = name?.trim();
  if (!trimmed || !platformId) return null;

  const customer = findCustomerByName(trimmed);
  const resolved = resolveCustomerType(customer?.id ?? null, platformId);
  const suggestedPrice = getSuggestedPrice(platformId, resolved.type);

  return {
    exists: Boolean(customer),
    customerId: customer?.id ?? null,
    tier: customer?.tier ?? null,
    score: customer?.score ?? 0,
    totalRevenue: customer?.totalRevenue ?? 0,
    ...resolved,
    suggestedPrice,
  };
}

/* ── 订单 ───────────────────────────────────────────── */

export async function updateOrderAction(formData: FormData) {
  const id = String(formData.get("id"));
  updateOrder(id, {
    price: Number(formData.get("price")),
    startDate: String(formData.get("startDate")),
    durationDays: Number(formData.get("durationDays")),
    device: String(formData.get("device") ?? ""),
    region: String(formData.get("region") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  refreshAll();
}

export async function deleteOrderAction(formData: FormData) {
  deleteOrder(String(formData.get("id")));
  refreshAll();
}

export async function renewOrderAction(formData: FormData) {
  const priceRaw = formData.get("price");
  const price = priceRaw ? Number(priceRaw) : undefined;
  renewOrder(String(formData.get("id")), Number.isFinite(price) ? { price } : {});
  refreshAll();
}

/* ── 成本 ───────────────────────────────────────────── */

export async function createCostAction(formData: FormData) {
  createCost({
    platformId: String(formData.get("platformId")),
    amount: Number(formData.get("amount")),
    costDate: String(formData.get("costDate")),
    periodDays: Number(formData.get("periodDays") ?? 30),
    category: String(formData.get("category") ?? "membership"),
    note: String(formData.get("note") ?? ""),
  });
  refreshAll();
}

export async function deleteCostAction(formData: FormData) {
  deleteCost(String(formData.get("id")));
  refreshAll();
}

/* ── 客户 ───────────────────────────────────────────── */

export async function updateCustomerNoteAction(formData: FormData) {
  const id = String(formData.get("id"));
  updateCustomerNote(id, String(formData.get("note") ?? ""));
  revalidatePath(`/customers/${id}`);
  revalidatePath("/customers");
}

/* ── 设置 ───────────────────────────────────────────── */

export async function savePricesAction(formData: FormData) {
  for (const [key, value] of formData.entries()) {
    const match = key.match(/^price:(.+):(new|returning)$/);
    if (!match) continue;
    const price = Number(value);
    if (Number.isFinite(price) && price >= 0) {
      setPrice(match[1], match[2] as "new" | "returning", price);
    }
  }
  revalidatePath("/settings");
  refreshAll();
}

export async function savePlatformAction(formData: FormData) {
  updatePlatform(String(formData.get("id")), {
    name: String(formData.get("name")),
    aliases: String(formData.get("aliases")),
  });
  revalidatePath("/settings");
}

export async function changePasswordAction(_prev: unknown, formData: FormData) {
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  if (next.length < 6) return { error: "新密码至少 6 位" };
  if (!changePassword(current, next)) return { error: "当前密码不正确" };
  return { success: "密码已更新" };
}

export async function runDailyAction() {
  await runDailyTasks();
  refreshAll();
}
