/**
 * 演示数据种子脚本。
 *   node scripts/seed-demo.mjs
 * 仅用于试用/演示，会写入若干客户、订单与成本记录。
 * 正式使用前请删除 data/app.db 重新开始。
 */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DAY = 86_400_000;
const dbPath = resolve(process.env.DATABASE_PATH || "./data/app.db");
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

const iso = (d) => new Date(d).toISOString().slice(0, 10);
const todayMs = Date.parse(iso(Date.now()));
const shift = (days) => iso(todayMs + days * DAY);

const PRICES = {
  iqiyi: { new: 13, returning: 11 },
  tencent: { new: 15, returning: 13 },
  bilibili: { new: 12, returning: 10 },
  mango: { new: 10, returning: 8 },
  youku: { new: 12, returning: 10 },
};

/**
 * 每位客户用「当前这单还剩几天到期 + 一共续过几轮」描述，
 * 脚本据此倒推出一串首尾相接的 30 天订单。
 * endsIn 直接决定了到期提醒列表：≤1 天进红色区，2–3 天进橙色区。
 */
const PEOPLE = [
  { name: "小陈", region: "浙江杭州", device: "iPhone17", note: "一直很守时，介绍过朋友", plans: [{ platform: "iqiyi", endsIn: 1, cycles: 5 }] },
  { name: "小李", region: "广东深圳", device: "华为Mate70", note: "回复很快", plans: [{ platform: "tencent", endsIn: 0, cycles: 3 }] },
  { name: "林姐", region: "上海", device: "iPad", note: "大客户，三个平台都在租", plans: [
    { platform: "iqiyi", endsIn: 29, cycles: 4 },
    { platform: "tencent", endsIn: 28, cycles: 2 },
    { platform: "mango", endsIn: 30, cycles: 1 },
  ] },
  { name: "老张", region: "江苏南京", device: "电视", note: "老客户，家里老人看", plans: [
    { platform: "youku", endsIn: 3, cycles: 3 },
    { platform: "iqiyi", endsIn: 18, cycles: 1 },
  ] },
  { name: "王五", region: "北京", device: "小米15", note: "", plans: [{ platform: "bilibili", endsIn: 27, cycles: 3 }] },
  { name: "小吴", region: "浙江宁波", device: "Mac", note: "学生党，价格敏感", plans: [{ platform: "bilibili", endsIn: 2, cycles: 2 }] },
  { name: "阿明", region: "四川成都", device: "OPPO", note: "", plans: [{ platform: "tencent", endsIn: 26, cycles: 2 }] },
  { name: "赵六", region: "湖南长沙", device: "iPad", note: "朋友介绍来的", plans: [{ platform: "mango", endsIn: 24, cycles: 1 }] },
  { name: "小周", region: "北京", device: "iPhone16", note: "新客户，首单", plans: [{ platform: "iqiyi", endsIn: 29, cycles: 1 }] },
  { name: "陈九", region: "福建厦门", device: "PC", note: "到期后没再续，可回访", plans: [{ platform: "youku", endsIn: -20, cycles: 1 }] },
];

const now = Date.now();

const insertCustomer = db.prepare(
  `INSERT INTO customer (id, name, note, region, device, total_orders, total_revenue,
     renewal_count, platform_count, score, tier, tags, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 'new', '', ?, ?)`,
);

const insertOrder = db.prepare(
  `INSERT INTO rental_order (id, customer_id, platform_id, price, start_date, duration_days,
     end_date, duration_type, customer_type, device, region, note, suggested_price,
     renewed_from_id, account_id, raw_text, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, 30, ?, 'month', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
);

const insertCost = db.prepare(
  `INSERT INTO cost_record (id, platform_id, amount, cost_date, period_days, category, note, raw_text, created_at)
   VALUES (?, ?, ?, ?, 30, 'membership', ?, '', ?)`,
);

const existing = db.prepare(`SELECT COUNT(*) AS n FROM rental_order`).get();
if (existing.n > 0) {
  console.log(`数据库已有 ${existing.n} 条订单，跳过演示数据写入。`);
  console.log("如需重新生成：rm -rf data/ 后先启动一次应用建表，再运行本脚本。");
  process.exit(0);
}

let orderCount = 0;

db.transaction(() => {
  for (const person of PEOPLE) {
    const customerId = randomUUID();
    insertCustomer.run(customerId, person.name, person.note, person.region, person.device, now, now);

    for (const plan of person.plans) {
      const price = PRICES[plan.platform];
      let previousId = null;

      // 最后一轮的到期日 = 今天 + endsIn，往前每 30 天一轮
      const lastStart = plan.endsIn - 30;

      for (let i = 0; i < plan.cycles; i++) {
        const startDate = shift(lastStart - (plan.cycles - 1 - i) * 30);
        const endDate = iso(Date.parse(startDate) + 30 * DAY);
        const type = i === 0 ? "new" : "returning";
        const orderId = randomUUID();

        insertOrder.run(
          orderId,
          customerId,
          plan.platform,
          price[type],
          startDate,
          endDate,
          type,
          person.device,
          person.region,
          i === 0 ? person.note : "",
          price[type],
          previousId,
          `${person.name} ${plan.platform} ${startDate} ${price[type]}`,
          now,
          now,
        );

        previousId = orderId;
        orderCount++;
      }
    }
  }

  // 成本：每个平台每月 1 号续一次月卡，覆盖最近 5 个月
  const COST = { iqiyi: 30, tencent: 33, bilibili: 25, mango: 20, youku: 26 };
  const firstOfMonth = (monthsAgo) => {
    const d = new Date(todayMs);
    return iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsAgo, 1));
  };
  let costCount = 0;
  for (let monthsAgo = 4; monthsAgo >= 0; monthsAgo--) {
    const date = firstOfMonth(monthsAgo);
    for (const [platform, amount] of Object.entries(COST)) {
      insertCost.run(
        randomUUID(),
        platform,
        amount,
        date,
        `${Number(date.slice(5, 7))}月月卡续费`,
        now,
      );
      costCount++;
    }
  }
  console.log(`已写入 ${costCount} 条成本记录`);
})();

// 让下次启动重新计算客户评分
db.prepare(`DELETE FROM app_setting WHERE key = 'lastDailyRun'`).run();

console.log(`已写入 ${PEOPLE.length} 位客户、${orderCount} 条订单`);
console.log("启动应用后系统会自动重算客户评分与分层。");
db.close();
