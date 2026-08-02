import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

/**
 * 日期约定：
 *  - startDate / endDate / costDate 存 TEXT 'YYYY-MM-DD'（字符串比较即可做区间查询）
 *  - createdAt / updatedAt 存 INTEGER 毫秒时间戳
 */

/** 平台：爱奇艺 / 腾讯视频 / 哔哩哔哩 / 芒果TV / 优酷 */
export const platforms = sqliteTable("platform", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** 文本解析别名，逗号分隔 */
  aliases: text("aliases").notNull().default(""),
  /** 图表配色槽位 1-5，固定不变 */
  colorSlot: integer("color_slot").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
  active: integer("active").notNull().default(1),
});

/** 客户（租户）。派生字段由每日任务与写入后重算刷新 */
export const customers = sqliteTable(
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
    totalRevenue: real("total_revenue").notNull().default(0),
    renewalCount: integer("renewal_count").notNull().default(0),
    platformCount: integer("platform_count").notNull().default(0),
    /** 优质度评分 0-100 */
    score: integer("score").notNull().default(0),
    /** diamond | gold | silver | normal | new */
    tier: text("tier").notNull().default("new"),
    /** 自动标签，逗号分隔 */
    tags: text("tags").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_customer_name").on(t.name)],
);

/** 租赁订单（核心表）。到期状态为派生值，不落库 */
export const rentalOrders = sqliteTable(
  "rental_order",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id").notNull(),
    platformId: text("platform_id").notNull(),
    /** 实收价格（元） */
    price: real("price").notNull(),
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
    suggestedPrice: real("suggested_price"),
    /** 续费自哪张订单 */
    renewedFromId: text("renewed_from_id"),
    /** P1 预留：绑定的平台账号 */
    accountId: text("account_id"),
    /** 原始录入文字，可回溯解析错误 */
    rawText: text("raw_text").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("idx_order_customer").on(t.customerId),
    index("idx_order_platform").on(t.platformId),
    index("idx_order_start").on(t.startDate),
    index("idx_order_end").on(t.endDate),
  ],
);

/** 成本记录：会员采购 / 其他支出 */
export const costRecords = sqliteTable(
  "cost_record",
  {
    id: text("id").primaryKey(),
    platformId: text("platform_id").notNull(),
    amount: real("amount").notNull(),
    costDate: text("cost_date").notNull(),
    /** 覆盖周期天数（月卡 30 / 季卡 90），供二期摊销使用 */
    periodDays: integer("period_days").notNull().default(30),
    /** membership | other */
    category: text("category").notNull().default("membership"),
    note: text("note").notNull().default(""),
    rawText: text("raw_text").notNull().default(""),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_cost_platform").on(t.platformId),
    index("idx_cost_date").on(t.costDate),
  ],
);

/** 定价规则：平台 × 新老客 → 建议价 */
export const priceRules = sqliteTable("price_rule", {
  id: text("id").primaryKey(),
  platformId: text("platform_id").notNull(),
  /** new | returning */
  customerType: text("customer_type").notNull(),
  price: real("price").notNull(),
});

/** 每日快照，供趋势图与历史回溯 */
export const dailySnapshots = sqliteTable("daily_snapshot", {
  date: text("date").primaryKey(),
  activeOrders: integer("active_orders").notNull().default(0),
  revenue: real("revenue").notNull().default(0),
  cost: real("cost").notNull().default(0),
  /** JSON：平台维度明细 */
  payload: text("payload").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
});

/** 系统设置键值表 */
export const appSettings = sqliteTable("app_setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type Platform = typeof platforms.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type RentalOrder = typeof rentalOrders.$inferSelect;
export type CostRecord = typeof costRecords.$inferSelect;
export type PriceRule = typeof priceRules.$inferSelect;
