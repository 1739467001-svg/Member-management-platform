import "server-only";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema";
import { DEFAULT_ACCOUNTS, DEFAULT_PLATFORMS, DEFAULT_PRICE_RULES } from "../constants";
import { hashPassword } from "../auth/password";

/**
 * 建表 DDL。刻意用 CREATE TABLE IF NOT EXISTS 在启动时执行，
 * 这样自托管部署不需要额外跑迁移命令——拷贝上去 `npm start` 即可。
 * 修改此处需同步 schema.ts。
 */
const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

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
  created_at  INTEGER NOT NULL
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
  total_revenue   REAL NOT NULL DEFAULT 0,
  renewal_count   INTEGER NOT NULL DEFAULT 0,
  platform_count  INTEGER NOT NULL DEFAULT 0,
  score           INTEGER NOT NULL DEFAULT 0,
  tier            TEXT NOT NULL DEFAULT 'new',
  tags            TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_name ON customer(name);

CREATE TABLE IF NOT EXISTS rental_order (
  id               TEXT PRIMARY KEY,
  customer_id      TEXT NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  platform_id      TEXT NOT NULL REFERENCES platform(id),
  price            REAL NOT NULL,
  start_date       TEXT NOT NULL,
  duration_days    INTEGER NOT NULL DEFAULT 30,
  end_date         TEXT NOT NULL,
  duration_type    TEXT NOT NULL DEFAULT 'month',
  customer_type    TEXT NOT NULL DEFAULT 'new',
  device           TEXT NOT NULL DEFAULT '',
  region           TEXT NOT NULL DEFAULT '',
  note             TEXT NOT NULL DEFAULT '',
  suggested_price  REAL,
  renewed_from_id  TEXT,
  account_id       TEXT,
  raw_text         TEXT NOT NULL DEFAULT '',
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_customer ON rental_order(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_platform ON rental_order(platform_id);
CREATE INDEX IF NOT EXISTS idx_order_start    ON rental_order(start_date);
CREATE INDEX IF NOT EXISTS idx_order_end      ON rental_order(end_date);

CREATE TABLE IF NOT EXISTS cost_record (
  id           TEXT PRIMARY KEY,
  platform_id  TEXT NOT NULL REFERENCES platform(id),
  amount       REAL NOT NULL,
  cost_date    TEXT NOT NULL,
  period_days  INTEGER NOT NULL DEFAULT 30,
  category     TEXT NOT NULL DEFAULT 'membership',
  note         TEXT NOT NULL DEFAULT '',
  raw_text     TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cost_platform ON cost_record(platform_id);
CREATE INDEX IF NOT EXISTS idx_cost_date     ON cost_record(cost_date);
CREATE INDEX IF NOT EXISTS idx_order_account ON rental_order(account_id);

CREATE TABLE IF NOT EXISTS price_rule (
  id             TEXT PRIMARY KEY,
  platform_id    TEXT NOT NULL REFERENCES platform(id),
  customer_type  TEXT NOT NULL,
  price          REAL NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_price_unique ON price_rule(platform_id, customer_type);

CREATE TABLE IF NOT EXISTS daily_snapshot (
  date           TEXT PRIMARY KEY,
  active_orders  INTEGER NOT NULL DEFAULT 0,
  revenue        REAL NOT NULL DEFAULT 0,
  cost           REAL NOT NULL DEFAULT 0,
  payload        TEXT NOT NULL DEFAULT '{}',
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_setting (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
`;

function createConnection() {
  // 路径来自环境变量，打包器无法静态分析 —— 产物裁剪交给
  // next.config.ts 的 outputFileTracingExcludes 处理
  const dbPath = resolve(process.env.DATABASE_PATH || "./data/app.db");
  mkdirSync(dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.exec(DDL);
  migrate(sqlite);

  const db = drizzle(sqlite, { schema });
  seed(sqlite);
  return { sqlite, db };
}

/**
 * 增量迁移：CREATE TABLE IF NOT EXISTS 只能新建表，管不了给已有表加列。
 * 已经在跑的库升级到新版本时，靠这里补齐字段。
 */
function migrate(sqlite: Database.Database) {
  const hasColumn = (table: string, column: string) =>
    (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(
      (c) => c.name === column,
    );

  if (!hasColumn("cost_record", "account_id")) {
    sqlite.exec(`ALTER TABLE cost_record ADD COLUMN account_id TEXT`);
  }
  if (!hasColumn("rental_order", "account_id")) {
    sqlite.exec(`ALTER TABLE rental_order ADD COLUMN account_id TEXT`);
  }
}

/** 首次启动写入预置数据；已存在则跳过，可重复执行 */
function seed(sqlite: Database.Database) {
  const insertPlatform = sqlite.prepare(
    `INSERT OR IGNORE INTO platform (id, name, aliases, color_slot, sort_order, active)
     VALUES (?, ?, ?, ?, ?, 1)`,
  );
  const insertPrice = sqlite.prepare(
    `INSERT OR IGNORE INTO price_rule (id, platform_id, customer_type, price)
     VALUES (?, ?, ?, ?)`,
  );
  const insertSetting = sqlite.prepare(
    `INSERT OR IGNORE INTO app_setting (key, value) VALUES (?, ?)`,
  );
  const insertAccount = sqlite.prepare(
    `INSERT OR IGNORE INTO account (id, label, note, active, sort_order, created_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  );

  sqlite.transaction(() => {
    DEFAULT_PLATFORMS.forEach((p, i) => {
      insertPlatform.run(p.id, p.name, p.aliases.join(","), p.colorSlot, i);
    });

    DEFAULT_ACCOUNTS.forEach((label, i) => {
      insertAccount.run(`acc-${label}`, label, "", i, Date.now());
    });

    for (const [platformId, prices] of Object.entries(DEFAULT_PRICE_RULES)) {
      insertPrice.run(`${platformId}-new`, platformId, "new", prices.new);
      insertPrice.run(`${platformId}-returning`, platformId, "returning", prices.returning);
    }

    insertSetting.run("defaultDurationDays", "30");
    insertSetting.run("alertThresholdDays", "1");
    insertSetting.run("warnThresholdDays", "3");
    insertSetting.run(
      "passwordHash",
      hashPassword(process.env.INITIAL_PASSWORD || "hhstudio2026"),
    );
  })();
}

// Next.js 开发模式会热重载模块，用 globalThis 保证单例，避免重复打开数据库文件
const globalForDb = globalThis as unknown as {
  __hhstudioDb?: ReturnType<typeof createConnection>;
};

/**
 * 延迟连接：只在真的执行查询时才建库。
 * 这很关键——若在模块导入时就连接，`next build` 收集页面信息时会生成一份
 * data/app.db，进而被产物追踪打进 standalone，等于把开发库发到了生产环境。
 */
function getConnection() {
  if (!globalForDb.__hhstudioDb) {
    globalForDb.__hhstudioDb = createConnection();
  }
  return globalForDb.__hhstudioDb;
}

/** 用 Proxy 保持 `db.select()...` 这种调用写法不变，同时把连接推迟到首次访问 */
export const db = new Proxy({} as ReturnType<typeof createConnection>["db"], {
  get: (_target, prop, receiver) => Reflect.get(getConnection().db, prop, receiver),
});

export const sqlite = new Proxy({} as ReturnType<typeof createConnection>["sqlite"], {
  get: (_target, prop) => {
    const value = Reflect.get(getConnection().sqlite, prop);
    return typeof value === "function" ? value.bind(getConnection().sqlite) : value;
  },
});

export * from "./schema";
