/**
 * 演示数据种子脚本。
 *   DATABASE_URL=postgres://... node scripts/seed-demo.mjs
 * 仅用于试用/演示，会写入若干客户、订单与成本记录。
 * 表结构由应用首次访问时自动创建，所以请先打开一次网站再跑本脚本。
 */
import postgres from "postgres";
import { randomUUID } from "node:crypto";

const url =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_POSTGRES_URL;

if (!url) {
  console.error("请先设置 DATABASE_URL，例如：");
  console.error("  DATABASE_URL='postgres://user:pass@host/db' node scripts/seed-demo.mjs");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

const DAY = 86_400_000;
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
  { name: "小陈", region: "浙江杭州", device: "iPhone17", note: "一直很守时，介绍过朋友", plans: [{ platform: "iqiyi", endsIn: 1, cycles: 5, account: "178" }] },
  { name: "小李", region: "广东深圳", device: "华为Mate70", note: "回复很快", plans: [{ platform: "tencent", endsIn: 0, cycles: 3, account: "1815" }] },
  { name: "林姐", region: "上海", device: "iPad", note: "大客户，三个平台都在租", plans: [
    { platform: "iqiyi", endsIn: 29, cycles: 4, account: "178" },
    { platform: "tencent", endsIn: 28, cycles: 2, account: "1815" },
    { platform: "mango", endsIn: 30, cycles: 1, account: "135" },
  ] },
  { name: "老张", region: "江苏南京", device: "电视", note: "老客户，家里老人看", plans: [
    { platform: "youku", endsIn: 3, cycles: 3, account: "181" },
    { platform: "iqiyi", endsIn: 18, cycles: 1, account: "178" },
  ] },
  { name: "王五", region: "北京", device: "小米15", note: "", plans: [{ platform: "bilibili", endsIn: 27, cycles: 3, account: "181" }] },
  { name: "小吴", region: "浙江宁波", device: "Mac", note: "学生党，价格敏感", plans: [{ platform: "bilibili", endsIn: 2, cycles: 2, account: "181" }] },
  { name: "阿明", region: "四川成都", device: "OPPO", note: "", plans: [{ platform: "tencent", endsIn: 26, cycles: 2, account: "1815" }] },
  { name: "赵六", region: "湖南长沙", device: "iPad", note: "朋友介绍来的", plans: [{ platform: "mango", endsIn: 24, cycles: 1, account: "135" }] },
  { name: "小周", region: "北京", device: "iPhone16", note: "新客户，首单", plans: [{ platform: "iqiyi", endsIn: 29, cycles: 1, account: "178" }] },
  { name: "陈九", region: "福建厦门", device: "PC", note: "到期后没再续，可回访", plans: [{ platform: "youku", endsIn: -20, cycles: 1, account: "181" }] },
];

// 每个平台的会员开在哪个账号上，成本就记到那个号
const COST = [
  { platform: "iqiyi", account: "178", amount: 30 },
  { platform: "tencent", account: "1815", amount: 33 },
  { platform: "bilibili", account: "181", amount: 25 },
  { platform: "mango", account: "135", amount: 20 },
  { platform: "youku", account: "181", amount: 26 },
];

try {
  const tableCheck = await sql`SELECT to_regclass('public.rental_order') AS t`;
  if (!tableCheck[0]?.t) {
    console.error("表还没建好。请先在浏览器里打开一次网站（会自动建表），再运行本脚本。");
    process.exit(1);
  }

  const existing = await sql`SELECT COUNT(*)::int AS n FROM rental_order`;
  if (existing[0].n > 0) {
    console.log(`数据库已有 ${existing[0].n} 条订单，跳过演示数据写入。`);
    console.log("如需重来：TRUNCATE rental_order, cost_record, customer CASCADE;");
    process.exit(0);
  }

  const now = Date.now();
  let orderCount = 0;

  for (const person of PEOPLE) {
    const customerId = randomUUID();
    await sql`
      INSERT INTO customer (id, name, note, region, device, total_orders, total_revenue,
        renewal_count, platform_count, score, tier, tags, created_at, updated_at)
      VALUES (${customerId}, ${person.name}, ${person.note}, ${person.region},
        ${person.device}, 0, 0, 0, 0, 0, 'new', '', ${now}, ${now})`;

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

        await sql`
          INSERT INTO rental_order (id, customer_id, platform_id, account_id, price,
            start_date, duration_days, end_date, duration_type, customer_type,
            device, region, note, suggested_price, renewed_from_id, raw_text,
            created_at, updated_at)
          VALUES (${orderId}, ${customerId}, ${plan.platform},
            ${plan.account ? `acc-${plan.account}` : null}, ${price[type]},
            ${startDate}, 30, ${endDate}, 'month', ${type},
            ${person.device}, ${person.region}, ${i === 0 ? person.note : ""},
            ${price[type]}, ${previousId},
            ${`${person.name} ${plan.platform} ${startDate} ${price[type]}`},
            ${now}, ${now})`;

        previousId = orderId;
        orderCount++;
      }
    }
  }

  // 成本：每个平台每月 1 号续一次月卡，覆盖最近 5 个月
  const firstOfMonth = (monthsAgo) => {
    const d = new Date(todayMs);
    return iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsAgo, 1));
  };
  let costCount = 0;
  for (let monthsAgo = 4; monthsAgo >= 0; monthsAgo--) {
    const date = firstOfMonth(monthsAgo);
    for (const { platform, account, amount } of COST) {
      await sql`
        INSERT INTO cost_record (id, platform_id, account_id, amount, cost_date,
          period_days, category, note, raw_text, created_at)
        VALUES (${randomUUID()}, ${platform}, ${`acc-${account}`}, ${amount}, ${date},
          30, 'membership', ${`${Number(date.slice(5, 7))}月月卡续费`}, '', ${now})`;
      costCount++;
    }
  }

  // 让下次访问重新计算客户评分
  await sql`DELETE FROM app_setting WHERE key = 'lastDailyRun'`;

  console.log(`已写入 ${PEOPLE.length} 位客户、${orderCount} 条订单、${costCount} 条成本记录`);
  console.log("刷新网站后系统会自动重算客户评分与分层。");
} finally {
  await sql.end();
}
