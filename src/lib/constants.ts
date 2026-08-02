/** 预置平台。colorSlot 为图表配色槽位，固定不变（颜色跟随平台身份，不随筛选重排） */
export const DEFAULT_PLATFORMS = [
  {
    id: "iqiyi",
    name: "爱奇艺",
    colorSlot: 1,
    aliases: ["爱奇艺", "奇艺", "iqiyi", "IQIYI", "爱奇艺会员"],
  },
  {
    id: "tencent",
    name: "腾讯视频",
    colorSlot: 2,
    aliases: ["腾讯视频", "腾讯", "tencent", "企鹅", "腾讯会员"],
  },
  {
    id: "bilibili",
    name: "哔哩哔哩",
    colorSlot: 3,
    aliases: ["哔哩哔哩", "哔哩", "bilibili", "B站", "b站", "小破站", "大会员"],
  },
  {
    id: "mango",
    name: "芒果TV",
    colorSlot: 4,
    aliases: ["芒果TV", "芒果tv", "芒果", "mango", "芒果会员"],
  },
  {
    id: "youku",
    name: "优酷",
    colorSlot: 5,
    aliases: ["优酷视频", "优酷", "youku", "优酷会员"],
  },
] as const;

/** 默认定价：新客首月原价吸引，老客续费降价留存 */
export const DEFAULT_PRICE_RULES: Record<string, { new: number; returning: number }> = {
  iqiyi: { new: 13, returning: 11 },
  tencent: { new: 15, returning: 13 },
  bilibili: { new: 12, returning: 10 },
  mango: { new: 10, returning: 8 },
  youku: { new: 12, returning: 10 },
};

export const PLATFORM_IDS = DEFAULT_PLATFORMS.map((p) => p.id);

/**
 * 预置会员账号。命名规则：取注册手机号前三位；前三位相同时补到第四位。
 * 目前在用 178 / 1815 / 181 / 135（1815 与 181 前三位相同，故 1815 补到四位）。
 * 账号可在设置页增删改；将来裁撤的账号停用即可，历史订单不受影响。
 */
export const DEFAULT_ACCOUNTS = ["178", "1815", "181", "135"];

/** 卡种 → 天数 */
export const DURATION_PRESETS = {
  day: 1,
  month: 30,
  quarter: 90,
} as const;

export type DurationType = keyof typeof DURATION_PRESETS | "custom";

export const DURATION_LABELS: Record<string, string> = {
  day: "日卡",
  month: "月卡",
  quarter: "季卡",
  custom: "自定义",
};

/** 到期状态阈值（天） */
export const ALERT_THRESHOLD_DAYS = 1; // 触发红色提醒
export const WARN_THRESHOLD_DAYS = 3; // 次级橙色预警

export type OrderStatus = "active" | "expiring_soon" | "expiring" | "expired";

export const ORDER_STATUS_META: Record<
  OrderStatus,
  { label: string; tone: "good" | "warning" | "serious" | "critical" | "muted" }
> = {
  active: { label: "生效中", tone: "good" },
  expiring_soon: { label: "3天内到期", tone: "warning" },
  expiring: { label: "即将到期", tone: "serious" },
  expired: { label: "已过期", tone: "muted" },
};

export type CustomerTier = "diamond" | "gold" | "silver" | "normal" | "new";

export const TIER_META: Record<
  CustomerTier,
  { label: string; icon: string; min: number; advice: string }
> = {
  diamond: { label: "钻石", icon: "◆", min: 80, advice: "赠送额外时长，优先保障优质账号" },
  gold: { label: "金牌", icon: "★", min: 60, advice: "续费可再让利，稳住长期复购" },
  silver: { label: "银牌", icon: "●", min: 40, advice: "到期前主动触达提醒续费" },
  normal: { label: "普通", icon: "○", min: 0, advice: "常规维护" },
  new: { label: "新客", icon: "✦", min: -1, advice: "主推「第二个月降价」促成第 2 单" },
};

export const TIER_ORDER: CustomerTier[] = ["diamond", "gold", "silver", "normal", "new"];

/** 客户评分权重（合计 100） */
export const SCORE_WEIGHTS = {
  revenue: 30, // 累计消费金额（相对分位）
  renewal: 25, // 续费次数占比
  tenure: 20, // 连续在租时长
  punctual: 15, // 按时续费率（到期 3 天内续）
  crossPlatform: 10, // 跨平台数
} as const;

/** 判定「按时续费」的宽限天数 */
export const PUNCTUAL_GRACE_DAYS = 3;
/** 新客转化观察窗口 */
export const CONVERSION_WINDOW_DAYS = 60;
/** 流失判定 */
export const CHURN_RISK_DAYS = 3;
export const CHURNED_DAYS = 30;
