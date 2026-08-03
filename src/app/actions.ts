"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { SESSION_COOKIE, SESSION_MAX_AGE, createSessionToken } from "@/lib/auth/session";
import { DatabaseInitError } from "@/lib/db";
import {
  checkPassword,
  changePassword,
  createAccount,
  setPrice,
  updateAccount,
  updatePlatform,
} from "@/lib/domain/settings";
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

/**
 * 会话 Cookie 是否加 Secure 标记。
 *
 * 不能简单用 NODE_ENV 判断：生产环境如果还没配 HTTPS（比如刚部署完直接用
 * http://服务器IP:3000 访问），带 Secure 的 Cookie 会被浏览器直接丢掉，
 * 表现就是「输对密码也一直跳回登录页」。localhost 是个例外，浏览器把它
 * 当可信来源，所以本地测不出这个问题。
 *
 * 这里按请求的实际协议来判断：走了 HTTPS（或反代透传了 x-forwarded-proto:https）
 * 才加 Secure；纯 HTTP 就不加，保证能登进去。
 */
async function shouldUseSecureCookie(): Promise<boolean> {
  // 需要强制时用 COOKIE_SECURE 显式覆盖
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;

  const proto = (await headers()).get("x-forwarded-proto")?.split(",")[0].trim();

  // 有反代头就照它说的办；没有就说明是直连 HTTP，不能加 Secure
  return proto === "https";
}

export async function loginAction(_prev: unknown, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (!password) return { error: "请输入密码" };

  // 校验密码要读数据库。存储没配好时这里会抛错，
  // 直接把原因显示在登录框下面，比甩一个 500 白屏有用得多。
  try {
    if (!(await checkPassword(password))) return { error: "密码不正确" };
  } catch (error) {
    if (error instanceof DatabaseInitError) {
      return { error: `${error.message}\n${error.hint}`, diagnostic: true };
    }
    console.error("[login]", error);
    return { error: "登录失败，请查看服务端日志或访问 /api/health 自检", diagnostic: true };
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: await shouldUseSecureCookie(),
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
  accountId?: string | null;
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
  accountId?: string | null;
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
      await createOrder(o as CreateOrderInput);
    }
    for (const c of payload.costs) {
      if (!c.platformId) return { ok: false, error: "请选择平台" };
      if (!Number.isFinite(c.amount)) return { ok: false, error: "金额必须是数字" };
      await createCost(c);
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

  const customer = await findCustomerByName(trimmed);
  const resolved = await resolveCustomerType(customer?.id ?? null, platformId);
  const suggestedPrice = await getSuggestedPrice(platformId, resolved.type);

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
  const accountId = String(formData.get("accountId") ?? "");
  await updateOrder(id, {
    price: Number(formData.get("price")),
    startDate: String(formData.get("startDate")),
    durationDays: Number(formData.get("durationDays")),
    accountId: accountId || null,
    device: String(formData.get("device") ?? ""),
    region: String(formData.get("region") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  refreshAll();
}

export async function deleteOrderAction(formData: FormData) {
  await deleteOrder(String(formData.get("id")));
  refreshAll();
}

export async function renewOrderAction(formData: FormData) {
  const priceRaw = formData.get("price");
  const price = priceRaw ? Number(priceRaw) : undefined;
  await renewOrder(String(formData.get("id")), Number.isFinite(price) ? { price } : {});
  refreshAll();
}

/* ── 成本 ───────────────────────────────────────────── */

export async function createCostAction(formData: FormData) {
  const accountId = String(formData.get("accountId") ?? "");
  await createCost({
    platformId: String(formData.get("platformId")),
    accountId: accountId || null,
    amount: Number(formData.get("amount")),
    costDate: String(formData.get("costDate")),
    periodDays: Number(formData.get("periodDays") ?? 30),
    category: String(formData.get("category") ?? "membership"),
    note: String(formData.get("note") ?? ""),
  });
  refreshAll();
}

export async function deleteCostAction(formData: FormData) {
  await deleteCost(String(formData.get("id")));
  refreshAll();
}

/* ── 客户 ───────────────────────────────────────────── */

export async function updateCustomerNoteAction(formData: FormData) {
  const id = String(formData.get("id"));
  await updateCustomerNote(id, String(formData.get("note") ?? ""));
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
      await setPrice(match[1], match[2] as "new" | "returning", price);
    }
  }
  revalidatePath("/settings");
  refreshAll();
}

export async function createAccountAction(formData: FormData) {
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return;
  await createAccount(label, String(formData.get("note") ?? ""));
  revalidatePath("/settings");
  refreshAll();
}

export async function saveAccountAction(formData: FormData) {
  await updateAccount(String(formData.get("id")), {
    label: String(formData.get("label") ?? "").trim(),
    note: String(formData.get("note") ?? ""),
    // 停用后不再出现在录入下拉与解析词典里，历史订单保持不变
    active: formData.get("active") === "on" ? 1 : 0,
  });
  revalidatePath("/settings");
  refreshAll();
}

export async function savePlatformAction(formData: FormData) {
  await updatePlatform(String(formData.get("id")), {
    name: String(formData.get("name")),
    aliases: String(formData.get("aliases")),
  });
  revalidatePath("/settings");
}

export async function changePasswordAction(_prev: unknown, formData: FormData) {
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  if (next.length < 4) return { error: "新密码至少 4 位" };
  if (!(await changePassword(current, next))) return { error: "当前密码不正确" };
  return { success: "密码已更新" };
}

export async function runDailyAction() {
  await runDailyTasks();
  refreshAll();
}
