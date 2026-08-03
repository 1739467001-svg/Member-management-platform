# HHStudio Junye 会员管理系统

视频会员租赁的账号、成本与收益管理系统。一行文字录入订单，系统自动算周期、提醒到期、
识别优质客户、按平台核算毛利。

**技术栈**：Next.js 16（App Router）· React 19 · TypeScript 5 · Tailwind CSS v4 ·
SQLite（better-sqlite3）· Drizzle ORM。无 Redis、无外部数据库、无第三方图表库，
单进程即可自托管。

> 需求文档见 [`docs/PRD.md`](docs/PRD.md)。

---

## 核心能力

| 能力 | 说明 |
|---|---|
| **一行文字录入** | `小陈 爱奇艺 178 2026.8.02 13 老顾客（备注）iphone17 浙江杭州` → 自动拆成 9 个字段，生成可编辑的确认卡片再入库 |
| **账号归属** | 会员账号按手机号前三位命名（前三位撞车时补第四位，如 181/1815）。订单与成本都可挂到具体账号，看板显示每个账号当前带几位租户 |
| **30 天周期管理** | 月卡 30 天、季卡 90 天，支持自定义有效天数或直接指定到期日 |
| **到期提醒** | 剩余 ≤1 天红色提醒、≤3 天橙色预警，每行可一键续费；已续过费的旧订单不会重复出现 |
| **优质客户识别** | 消费金额、续费次数、在租时长、按时率、跨平台 五维加权评分，自动分层与打标 |
| **新老客定价** | 按「该客户在该平台的历史单数」自动判定身份，带出建议价，支持人工议价并留痕 |
| **成本归集** | 表单录入或文字录入（`成本 爱奇艺 8.1 30 月卡续费`），平台 × 月份矩阵一目了然 |
| **周 / 月 / 年报表** | 按平台大类算清 收入 − 成本 = 毛利，支持复制 Markdown 报表与导出 CSV |
| **每日自动更新** | 内置调度器每日重算评分、生成快照并自动备份数据库 |

---

## 快速开始（本地）

```bash
npm install

# 配置环境变量
cp .env.example .env
# 至少要改 AUTH_SECRET：openssl rand -hex 32

npm run dev          # http://localhost:3000
```

首次登录密码取 `.env` 里的 `INITIAL_PASSWORD`（默认 `hhstudio2026`），登录后可在设置页修改。

想先看看效果，可以灌一批演示数据：

```bash
npm run dev          # 先启动一次，让系统建好表
npm run seed:demo    # 写入 10 位客户、约 30 条订单与 5 个月成本
```

---

## 部署到自己的云服务器

### 方式一：Docker（推荐）

```bash
# 1. 准备环境变量
cat > .env <<'EOF'
AUTH_SECRET=<openssl rand -hex 32 的结果>
INITIAL_PASSWORD=<你的登录密码>
CRON_TOKEN=<随便一串随机字符>
TZ=Asia/Shanghai
EOF

# 2. 起服务
docker compose up -d --build

# 3. 查看日志
docker compose logs -f
```

数据库落在具名卷 `hhstudio-data` 的 `/data/app.db`，容器重建不丢数据。

备份：

```bash
docker compose exec app sh -c 'cat /data/app.db' > backup-$(date +%F).db
```

### 方式二：裸机 Node（无 Docker）

```bash
npm ci
npm run build        # 构建后会自动把静态资源拷进 standalone 产物

# ⚠️ standalone 的 server.js 会把工作目录切到自己所在的文件夹，
#    所以 DATABASE_PATH 必须写绝对路径，否则数据库会落在 .next/standalone/data 下
AUTH_SECRET=xxx \
INITIAL_PASSWORD=xxx \
DATABASE_PATH=/srv/hhstudio/data/app.db \
BACKUP_PATH=/srv/hhstudio/backup \
TZ=Asia/Shanghai \
PORT=3000 \
node .next/standalone/server.js
```

配合 systemd 常驻：

```ini
# /etc/systemd/system/hhstudio.service
[Unit]
Description=HHStudio Membership
After=network.target

[Service]
WorkingDirectory=/srv/hhstudio
ExecStart=/usr/bin/node /srv/hhstudio/.next/standalone/server.js
Environment=NODE_ENV=production
Environment=TZ=Asia/Shanghai
Environment=PORT=3000
Environment=AUTH_SECRET=<改我>
Environment=DATABASE_PATH=/srv/hhstudio/data/app.db
Environment=BACKUP_PATH=/srv/hhstudio/backup
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

### 反向代理（Caddy 示例）

```caddyfile
hh.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy 会自动申请证书并透传 `X-Forwarded-Proto`，无需额外配置。
用 Nginx 的话见下面「部署前必看的几个坑」第 1 条。

### 手机 / 平板

页面已适配手机、平板与桌面三档：手机走底部导航 + 卡片式列表，
平板起显示侧边栏。用手机浏览器打开后选「添加到主屏幕」，
可以像 App 一样全屏打开（图标与启动配置已内置）。

---

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `AUTH_SECRET` | ✅ | 会话签名密钥，至少 16 字符。**生产必须修改** |
| `INITIAL_PASSWORD` | | 首次启动写入的登录密码，默认 `hhstudio2026` |
| `DATABASE_PATH` | | SQLite 文件路径，默认 `./data/app.db`。**standalone 部署请用绝对路径** |
| `BACKUP_PATH` | | 备份目录，默认 `./backup`，保留最近 30 份 |
| `CRON_TOKEN` | | 每日任务 HTTP 端点的调用令牌；不设则该端点不鉴权 |
| `COOKIE_SECURE` | | 强制会话 Cookie 的 Secure 标记（`true`/`false`）。默认按请求协议自动判断，一般不用设 |
| `TZ` | | 业务时区，默认 `Asia/Shanghai` |

---

## 这个架构适合部署在哪里

| 环境 | 是否可用 | 说明 |
|---|---|---|
| **云服务器**（阿里云 ECS / 腾讯云轻量 / 华为云 / 自建 VPS） | ✅ 推荐 | 有持久磁盘，SQLite 单文件跑得又快又省心。512MB 内存足够 |
| **Docker**（跑在上述服务器上） | ✅ 推荐 | 数据落具名卷；entrypoint 会自动纠正挂载目录属主 |
| **Vercel / Netlify / 各家函数计算** | ❌ 不可用 | 文件系统只读、实例随时销毁重建，本机 SQLite 存不下数据。**症状正是「登录页能打开，一提交密码就报服务器错误」** |
| **Cloudflare Workers / Pages** | ❌ 不可用 | 同上，且不支持 Node 原生模块 |

如果一定要用无服务器平台，数据层得换成网络数据库（Neon / Supabase 的
Postgres，或 Turso 这类托管 SQLite）。这是一次实打实的改造，不是改个配置能解决的 ——
需要的话告诉我，我来改。

**判断自己属于哪种情况**：部署后访问 `/api/health`（不需要登录），
它会直接告诉你数据库路径、目录是否可写、原生模块能否加载、以及运行架构。

---

## 部署前必看的几个坑

这几条都是实际踩过并验证过的，不是理论风险：

**1. 用 IP + HTTP 直接访问时能不能登录**

会话 Cookie 的 `Secure` 标记按请求的实际协议自动判断：
走 HTTPS（或反代传了 `x-forwarded-proto: https`）才加，纯 HTTP 不加。
所以 `http://服务器IP:3000` 可以正常登录。
如果加了 `Secure` 又走 HTTP，浏览器会**静默丢弃** Cookie —— 表现是「密码明明是对的，
一登录就弹回登录页」。注意 `localhost` 是浏览器的例外，本地永远测不出这个问题。

配好 HTTPS 后，Nginx/Caddy 请务必透传协议头：

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header Host $host;
```

**1.5 登录报「服务器错误」怎么查**

先访问 `/api/health`（无需登录）。它会返回类似：

```json
{
  "ok": false,
  "checks": {
    "dbPath": "/data/app.db",
    "dataDirWritable": false,
    "dataDirError": "EACCES",
    "nativeModuleLoaded": true,
    "arch": "x64"
  }
}
```

- `dataDirError: EACCES` → 目录没写权限。Docker 用 bind mount 时执行
  `chown -R 1001:1001 <宿主目录>`（用本仓库的 compose 则已自动处理）
- `dataDirError: EROFS` → 文件系统只读，说明部署在了无服务器平台，见上一节
- `nativeModuleLoaded: false` → 原生模块架构不匹配，在目标机重新构建
- `dbPathIsAbsolute: false` → 见下一条

登录页现在也会把具体原因直接显示在密码框下方，不再是空白的 500 页。

**2. 裸机部署时 `DATABASE_PATH` 必须写绝对路径**

standalone 的 `server.js` 启动时会把工作目录切到它自己所在的文件夹。
写相对路径的话，数据库会跑到 `.next/standalone/data/` 里去，
下次重新构建就「数据不见了」。

**3. 跨架构复制产物会挂**

`better-sqlite3` 带的是预编译二进制。x64 机器上构建的 `.next/standalone`
直接拷到 ARM 服务器（倚天 / Graviton 等）会因为找不到匹配的 `.node` 而启动失败。
**在目标服务器上构建**，或者用 Docker（镜像在目标架构上构建）就没这问题。

**4. 备份别只留在同一块盘上**

系统每天自动备份到 `BACKUP_PATH`，但那和数据库在同一个卷里 —— 卷没了就一起没了。
建议加一条 crontab 往外拷：

```cron
30 3 * * * cp /var/lib/docker/volumes/hhstudio-data/_data/app.db /mnt/backup/hh-$(date +\%F).db
```

**5. 容器里灌演示数据**

`npm run seed:demo` 在容器内不可用（standalone 产物里的 `package.json` 没有 scripts）。
直接调脚本：

```bash
docker compose exec app node scripts/seed-demo.mjs
```

---

## 每日任务

应用内置调度器每 15 分钟检查一次日期是否翻篇，翻了就自动执行。
**订单剩余天数是查询时实时计算的，不依赖定时任务**，所以即使某天没跑成，页面数据依然准确 ——
定时任务只负责重算客户评分、写入统计快照和备份数据库。

如需系统级兜底，可用 crontab 调用：

```cron
5 0 * * * curl -fsS -H "Authorization: Bearer $CRON_TOKEN" http://127.0.0.1:3000/api/cron/daily
```

也可以随时在「系统设置 → 立即执行每日任务」手动触发。

---

## 项目结构

```
src/
├── app/
│   ├── (app)/              登录后的页面：看板 / 订单 / 客户 / 成本 / 报表 / 设置
│   ├── api/cron/daily/     每日任务 HTTP 端点
│   ├── login/              登录页
│   └── actions.ts          全部 Server Actions
├── components/
│   ├── QuickEntry.tsx      文字录入 + 实时解析 + 确认卡片
│   ├── ExpiringAlert.tsx   到期提醒
│   ├── charts.tsx          手写 SVG 图表
│   └── ui.tsx              基础组件
├── lib/
│   ├── parser/             自然语言解析（纯函数，前后端共用）
│   ├── domain/             业务逻辑：订单 / 客户评分 / 成本 / 报表 / 每日任务
│   ├── db/                 SQLite schema 与连接
│   ├── date.ts             日期与周期计算
│   └── auth/               密码哈希与会话
└── middleware.ts           登录拦截
```

---

## 几个设计上的取舍

- **订单状态不落库**：剩余天数每次查询实时算，跨零点自动生效，不会因为定时任务没跑而显示错误。
- **毛利只在平台层核算**：一个账号的成本可以同时服务多位租户，单笔订单的「毛利」没有意义。
- **成本用现金口径**：按实际支付日全额计入当期，对账直观。代价是月初刚续完会员时毛利会先显示为负，
  报表页会明确提示本期进度。若需按天摊销，见 PRD 的二期规划。
- **数据库延迟连接**：只有真正执行查询时才建库，避免 `next build` 期间生成的开发库被打进部署产物。
- **无第三方图表库**：图表是手写 SVG，包体小、配色可控，且能保证「图例 + 数值直接标注 + 表格视图」
  三重可读性，不依赖颜色单独传递信息。
