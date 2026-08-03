import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { DEFAULT_ACCOUNTS, DEFAULT_PLATFORMS, DEFAULT_PRICE_RULES } from "../constants";
import { hashPassword } from "../auth/password";

/**
 * 建表 DDL。用 CREATE TABLE IF NOT EXISTS 在首次访问时执行，
 * 这样部署不需要单独跑迁移命令 —— Vercel 上尤其省事。
 * 修改此处需同步 schema.ts。
 *
 * 注意：毫秒时间戳一律 BIGINT。用 INTEGER 会在 2038 年之前就溢出，
 * 实际上现在就已经超了（1.7e12 > 2.1e9）。
 */
const DDL = `
CREATE TABLE IF NOT EXISTS platform (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  aliases     TEXT NOT NULL DEFAULT '',
  color_slot  INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS account (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_label ON account(label);

CREATE TABLE IF NOT EXISTS customer (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  note            TEXT NOT NULL DEFAULT '',
  region          TEXT NOT NULL DEFAULT '',
  device          TEXT NOT NULL DEFAULT '',
  first_order_at  TEXT,
  last_order_at   TEXT,
  total_orders    INTEGER NOT NULL DEFAULT 0,
  total_revenue   DOUBLE PRECISION NOT NULL DEFAULT 0,
  renewal_count   INTEGER NOT NULL DEFAULT 0,
  platform_count  INTEGER NOT NULL DEFAULT 0,
  score           INTEGER NOT NULL DEFAULT 0,
  tier            TEXT NOT NULL DEFAULT 'new',
  tags            TEXT NOT NULL DEFAULT '',
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_name ON customer(name);

CREATE TABLE IF NOT EXISTS rental_order (
  id               TEXT PRIMARY KEY,
  customer_id      TEXT NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  platform_id      TEXT NOT NULL REFERENCES platform(id),
  account_id       TEXT,
  price            DOUBLE PRECISION NOT NULL,
  start_date       TEXT NOT NULL,
  duration_days    INTEGER NOT NULL DEFAULT 30,
  end_date         TEXT NOT NULL,
  duration_type    TEXT NOT NULL DEFAULT 'month',
  customer_type    TEXT NOT NULL DEFAULT 'new',
  device           TEXT NOT NULL DEFAULT '',
  region           TEXT NOT NULL DEFAULT '',
  note             TEXT NOT NULL DEFAULT '',
  suggested_price  DOUBLE PRECISION,
  renewed_from_id  TEXT,
  raw_text         TEXT NOT NULL DEFAULT '',
  created_at       BIGINT NOT NULL,
  updated_at       BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_customer ON rental_order(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_platform ON rental_order(platform_id);
CREATE INDEX IF NOT EXISTS idx_order_account  ON rental_order(account_id);
CREATE INDEX IF NOT EXISTS idx_order_start    ON rental_order(start_date);
CREATE INDEX IF NOT EXISTS idx_order_end      ON rental_order(end_date);

CREATE TABLE IF NOT EXISTS cost_record (
  id           TEXT PRIMARY KEY,
  platform_id  TEXT NOT NULL REFERENCES platform(id),
  account_id   TEXT,
  amount       DOUBLE PRECISION NOT NULL,
  cost_date    TEXT NOT NULL,
  period_days  INTEGER NOT NULL DEFAULT 30,
  category     TEXT NOT NULL DEFAULT 'membership',
  note         TEXT NOT NULL DEFAULT '',
  raw_text     TEXT NOT NULL DEFAULT '',
  created_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cost_platform ON cost_record(platform_id);
CREATE INDEX IF NOT EXISTS idx_cost_date     ON cost_record(cost_date);

CREATE TABLE IF NOT EXISTS price_rule (
  id             TEXT PRIMARY KEY,
  platform_id    TEXT NOT NULL REFERENCES platform(id),
  customer_type  TEXT NOT NULL,
  price          DOUBLE PRECISION NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_price_unique ON price_rule(platform_id, customer_type);

CREATE TABLE IF NOT EXISTS daily_snapshot (
  date           TEXT PRIMARY KEY,
  active_orders  INTEGER NOT NULL DEFAULT 0,
  revenue        DOUBLE PRECISION NOT NULL DEFAULT 0,
  cost           DOUBLE PRECISION NOT NULL DEFAULT 0,
  payload        TEXT NOT NULL DEFAULT '{}',
  created_at     BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_setting (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
`;

/** 连接串缺失时抛这个，页面据此给出可执行的处理建议 */
export class DatabaseInitError extends Error {
  constructor(
    readonly stage: string,
    readonly cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`数据库初始化失败（${stage}）：${detail}`);
    this.name = "DatabaseInitError";
  }

  get hint(): string {
    const msg = String(this.cause);
    if (this.stage === "读取连接串") {
      return "没有配置 DATABASE_URL。Vercel 上请到 Storage 里创建一个 Postgres 数据库（推荐 Neon），它会自动把连接串注入到项目环境变量；本地开发则在 .env 里填 DATABASE_URL。";
    }
    if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
      return "连不上数据库，请检查 DATABASE_URL 的主机名与端口是否正确、数据库是否已启动。";
    }
    if (msg.includes("password authentication") || msg.includes("SASL")) {
      return "数据库用户名或密码不对，请重新复制一次连接串。";
    }
    if (msg.includes("does not exist")) {
      return "连接串里指定的数据库不存在，请先创建，或改用正确的库名。";
    }
    return "请查看部署平台的运行日志中的原始错误，或访问 /api/health 自检。";
  }
}

function getConnectionString(): string {
  // Vercel 各家 Postgres 集成注入的变量名不统一，挨个兜住
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.DATABASE_POSTGRES_URL;

  if (!url) throw new DatabaseInitError("读取连接串", "DATABASE_URL 未设置");
  return url;
}

function createClient() {
  const url = getConnectionString();

  return postgres(url, {
    // 无服务器环境每个实例只需一条连接；连接数留给横向扩展
    max: 1,
    idle_timeout: 20,
    connect_timeout: 15,
    // 走连接池（Neon pooler / PgBouncer）时必须关掉预编译语句
    prepare: false,
    ssl: url.includes("sslmode=disable") ? false : "prefer",
    onnotice: () => {},
  });
}

// 开发模式热重载与无服务器实例复用，都靠 globalThis 保住单例
const globalForDb = globalThis as unknown as {
  __hhstudioSql?: ReturnType<typeof createClient>;
  __hhstudioDb?: ReturnType<typeof drizzle<typeof schema>>;
  __hhstudioReady?: Promise<void>;
};

/**
 * 延迟创建连接。不能在模块顶层就建 —— DATABASE_URL 在构建期并不存在，
 * 顶层创建会让 `next build` 直接失败。
 */
export function getSql(): ReturnType<typeof createClient> {
  if (!globalForDb.__hhstudioSql) {
    globalForDb.__hhstudioSql = createClient();
  }
  return globalForDb.__hhstudioSql;
}

export function getDb() {
  if (!globalForDb.__hhstudioDb) {
    globalForDb.__hhstudioDb = drizzle(getSql(), { schema });
  }
  return globalForDb.__hhstudioDb;
}

/**
 * 首次调用时建表并写入预置数据；之后的调用直接复用同一个 Promise。
 * 每个需要读写数据库的入口都先 await 它，
 * 这样部署完直接访问就能用，不必手动跑迁移。
 */
export function ready(): Promise<void> {
  if (!globalForDb.__hhstudioReady) {
    globalForDb.__hhstudioReady = bootstrap().catch((error) => {
      // 失败就清掉缓存，下次请求可以重试（比如数据库刚好在重启）
      globalForDb.__hhstudioReady = undefined;
      throw error;
    });
  }
  return globalForDb.__hhstudioReady;
}

async function bootstrap(): Promise<void> {
  let stage = "读取连接串";
  try {
    const pg = getSql();

    stage = "建表";
    await pg.unsafe(DDL);

    stage = "写入预置数据";
    await seed(pg);
  } catch (error) {
    if (error instanceof DatabaseInitError) throw error;
    console.error(`[db] ${stage}失败`, error);
    throw new DatabaseInitError(stage, error);
  }
}

/** 首次启动写入预置数据；已存在则跳过，可重复执行 */
async function seed(pg: ReturnType<typeof createClient>): Promise<void> {
  for (const [i, p] of DEFAULT_PLATFORMS.entries()) {
    await pg`
      INSERT INTO platform (id, name, aliases, color_slot, sort_order, active)
      VALUES (${p.id}, ${p.name}, ${p.aliases.join(",")}, ${p.colorSlot}, ${i}, 1)
      ON CONFLICT (id) DO NOTHING`;
  }

  for (const [i, label] of DEFAULT_ACCOUNTS.entries()) {
    await pg`
      INSERT INTO account (id, label, note, active, sort_order, created_at)
      VALUES (${`acc-${label}`}, ${label}, '', 1, ${i}, ${Date.now()})
      ON CONFLICT (id) DO NOTHING`;
  }

  for (const [platformId, prices] of Object.entries(DEFAULT_PRICE_RULES)) {
    await pg`
      INSERT INTO price_rule (id, platform_id, customer_type, price)
      VALUES (${`${platformId}-new`}, ${platformId}, 'new', ${prices.new})
      ON CONFLICT (id) DO NOTHING`;
    await pg`
      INSERT INTO price_rule (id, platform_id, customer_type, price)
      VALUES (${`${platformId}-returning`}, ${platformId}, 'returning', ${prices.returning})
      ON CONFLICT (id) DO NOTHING`;
  }

  const settings: Array<[string, string]> = [
    ["defaultDurationDays", "30"],
    ["alertThresholdDays", "1"],
    ["warnThresholdDays", "3"],
    ["passwordHash", hashPassword(process.env.INITIAL_PASSWORD || "0000")],
  ];
  for (const [key, value] of settings) {
    await pg`
      INSERT INTO app_setting (key, value) VALUES (${key}, ${value})
      ON CONFLICT (key) DO NOTHING`;
  }
}

export * from "./schema";
