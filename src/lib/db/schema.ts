import {
  pgTable,
  text,
  integer,
  bigint,
  doublePrecision,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * 日期约定：
 *  - startDate / endDate / costDate 存 TEXT 'YYYY-MM-DD'（字符串比较即可做区间查询，
 *    也避开了服务器时区与业务时区不一致的坑）
 *  - createdAt / updatedAt 存毫秒时间戳。必须用 bigint —— 毫秒时间戳约 1.7e12，
 *    远超 Postgres integer 的 2.1e9 上限，用 integer 会直接溢出报错。
 */

/** 平台：爱奇艺 / 腾讯视频 / 哔哩哔哩 / 芒果TV / 优酷 */
export const platforms = pgTable("platform", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** 文本解析别名，逗号分隔 */
  aliases: text("aliases").notNull().default(""),
  /** 图表配色槽位 1-5，固定不变 */
  colorSlot: integer("color_slot").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
  active: integer("active").notNull().default(1),
});

/**
 * 会员账号。命名取注册手机号的前三位，前三位撞车时补到第四位（如 181 / 1815）。
 * 一个账号可以在多个平台开会员，也可以同时租给多位客户 —— 所以「账号 × 平台」
 * 才是一份成本对应多份收入的那个点。
 */
export const accounts = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    /** 显示名，如 178 */
    label: text("label").notNull(),
    note: text("note").notNull().default(""),
    /** 停用后不再出现在录入下拉里，但历史订单照常保留（如将来裁撤的 1815） */
    active: integer("active").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("idx_account_label").on(t.label)],
);

/** 客户（租户）。派生字段由每日任务与写入后重算刷新 */
export const customers = pgTable(
  "customer",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    note: text("note").notNull().default(""),
    region: text("region").notNull().default(""),
    device: text("device").notNull().default(""),
    firstOrderAt: text("first_order_at"),
    lastOrderAt: text("last_order_at"),
    totalOrders: integer("total_orders").notNull().default(0),
    totalRevenue: doublePrecision("total_revenue").notNull().default(0),
    renewalCount: integer("renewal_count").notNull().default(0),
    platformCount: integer("platform_count").notNull().default(0),
    /** 优质度评分 0-100 */
    score: integer("score").notNull().default(0),
    /** diamond | gold | silver | normal | new */
    tier: text("tier").notNull().default("new"),
    /** 自动标签，逗号分隔 */
    tags: text("tags").notNull().default(""),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [index("idx_customer_name").on(t.name)],
);

/** 租赁订单（核心表）。到期状态为派生值，不落库 */
export const rentalOrders = pgTable(
  "rental_order",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id").notNull(),
    platformId: text("platform_id").notNull(),
    /** 该客户用的是哪个会员账号 */
    accountId: text("account_id"),
    /** 实收价格（元） */
    price: doublePrecision("price").notNull(),
    startDate: text("start_date").notNull(),
    /** 有效天数，月卡默认 30，支持自定义 */
    durationDays: integer("duration_days").notNull().default(30),
    /** 冗余落库，便于区间查询 */
    endDate: text("end_date").notNull(),
    /** month(30) | quarter(90) | day(1) | custom —— 日卡已预留 */
    durationType: text("duration_type").notNull().default("month"),
    /** 下单时身份快照：new | returning */
    customerType: text("customer_type").notNull().default("new"),
    device: text("device").notNull().default(""),
    region: text("region").notNull().default(""),
    note: text("note").notNull().default(""),
    /** 系统建议价，留痕用于分析议价空间 */
    suggestedPrice: doublePrecision("suggested_price"),
    /** 续费自哪张订单 */
    renewedFromId: text("renewed_from_id"),
    /** 原始录入文字，可回溯解析错误 */
    rawText: text("raw_text").notNull().default(""),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("idx_order_customer").on(t.customerId),
    index("idx_order_platform").on(t.platformId),
    index("idx_order_account").on(t.accountId),
    index("idx_order_start").on(t.startDate),
    index("idx_order_end").on(t.endDate),
  ],
);

/** 成本记录：会员采购 / 其他支出 */
export const costRecords = pgTable(
  "cost_record",
  {
    id: text("id").primaryKey(),
    platformId: text("platform_id").notNull(),
    /** 这笔钱是给哪个账号续的；留空表示按平台整体记账 */
    accountId: text("account_id"),
    amount: doublePrecision("amount").notNull(),
    costDate: text("cost_date").notNull(),
    /** 覆盖周期天数（月卡 30 / 季卡 90），供二期摊销使用 */
    periodDays: integer("period_days").notNull().default(30),
    /** membership | other */
    category: text("category").notNull().default("membership"),
    note: text("note").notNull().default(""),
    rawText: text("raw_text").notNull().default(""),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("idx_cost_platform").on(t.platformId),
    index("idx_cost_date").on(t.costDate),
  ],
);

/** 定价规则：平台 × 新老客 → 建议价 */
export const priceRules = pgTable(
  "price_rule",
  {
    id: text("id").primaryKey(),
    platformId: text("platform_id").notNull(),
    /** new | returning */
    customerType: text("customer_type").notNull(),
    price: doublePrecision("price").notNull(),
  },
  (t) => [uniqueIndex("idx_price_unique").on(t.platformId, t.customerType)],
);

/** 每日快照，供趋势图与历史回溯 */
export const dailySnapshots = pgTable("daily_snapshot", {
  date: text("date").primaryKey(),
  activeOrders: integer("active_orders").notNull().default(0),
  revenue: doublePrecision("revenue").notNull().default(0),
  cost: doublePrecision("cost").notNull().default(0),
  /** JSON：平台维度明细 */
  payload: text("payload").notNull().default("{}"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

/** 系统设置键值表 */
export const appSettings = pgTable("app_setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type Platform = typeof platforms.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type RentalOrder = typeof rentalOrders.$inferSelect;
export type CostRecord = typeof costRecords.$inferSelect;
export type PriceRule = typeof priceRules.$inferSelect;
