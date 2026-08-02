import type { CustomerTier, OrderStatus } from "../constants";

/** 订单 + 关联客户/平台 + 派生状态，页面直接消费的形态 */
export type OrderView = {
  id: string;
  customerId: string;
  customerName: string;
  customerTier: CustomerTier;
  customerScore: number;
  platformId: string;
  platformName: string;
  colorSlot: number;
  price: number;
  suggestedPrice: number | null;
  startDate: string;
  endDate: string;
  durationDays: number;
  durationType: string;
  customerType: "new" | "returning";
  device: string;
  region: string;
  note: string;
  renewedFromId: string | null;
  /** 派生：不落库，保证任意时刻查询都准确 */
  status: OrderStatus;
  daysLeft: number;
};

export type CustomerView = {
  id: string;
  name: string;
  note: string;
  region: string;
  device: string;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  totalOrders: number;
  totalRevenue: number;
  renewalCount: number;
  platformCount: number;
  score: number;
  tier: CustomerTier;
  tags: string[];
  /** 当前是否还有在租订单 */
  activeOrders: number;
};

export type PlatformStat = {
  platformId: string;
  platformName: string;
  colorSlot: number;
  orders: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
};

export type PeriodSummary = {
  label: string;
  start: string;
  end: string;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  orders: number;
  customers: number;
  newCustomers: number;
  renewals: number;
  platforms: PlatformStat[];
};
