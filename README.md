# HHStudio Junye 会员管理系统

视频会员租赁的账号、成本与收益管理系统。一行文字录入订单，系统自动算周期、提醒到期、
识别优质客户、按平台与账号核算毛利。

**技术栈**：Next.js 16（App Router）· React 19 · TypeScript 5 · Tailwind CSS v4 ·
PostgreSQL · Drizzle ORM · postgres.js。无 Redis、无第三方图表库。

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
| **成本归集** | 表单录入或文字录入（`成本 爱奇艺 178 8.1 30 月卡续费`），平台 × 月份矩阵一目了然 |
| **周 / 月 / 年报表** | 按平台与账号两个维度算清 收入 − 成本 = 毛利，支持复制 Markdown 报表与导出 CSV |
| **每日自动更新** | 每日重算客户评分、生成统计快照 |
| **多端适配** | 手机底部导航 + 卡片列表，平板起显示侧边栏；可「添加到主屏幕」当 App 用 |

---

## 部署到 Vercel

数据存在 Postgres 里，Vercel 完全可用。五步：

**第 1 步 · 导入项目**
Vercel → Add New → Project → 选中这个 GitHub 仓库 → Import。
框架自动识别为 Next.js，构建命令不用改。

**第 2 步 · 建数据库（关键，不建就登录不了）**
进项目 → 顶部 **Storage** → **Create Database** → 选 **Neon (Postgres)** →
Region 选离你近的（如 Singapore）→ Create。
建好后点 **Connect Project** 关联到本项目 —— 它会自动把 `DATABASE_URL`
注入环境变量，不用手动复制。

**第 3 步 · 补几个环境变量**
Settings → Environment Variables（Production 与 Preview 都勾上）：

| Key | Value | 说明 |
|---|---|---|
| `AUTH_SECRET` | `openssl rand -hex 32` 生成的一串 | 会话签名密钥，必填 |
| `TZ` | `Asia/Shanghai` | **必填**。Vercel 默认 UTC，不设的话「今天」会算错，到期提醒差一天 |
| `INITIAL_PASSWORD` | `0000` | 首次建库时写入的登录密码 |
| `CRON_SECRET` | 随便一串随机字符 | 保护每日任务端点 |

**第 4 步 · 重新部署**
Deployments → 最新那条 → ⋯ → **Redeploy**。
环境变量只在部署时注入，第 3 步加完必须重新部署一次才生效。

**第 5 步 · 验证**
先访问 `https://你的域名/api/health`，看到 `"ok": true` 就说明数据库通了；
再打开首页登录。**表结构在首次访问时自动创建，不需要手动跑迁移。**

想先看看效果，可以灌演示数据（本地执行，连线上库）：

```bash
DATABASE_URL='<从 Vercel 复制的连接串>' npm run seed:demo
```

### Vercel 相关注意点

- **每日任务**：`vercel.json` 已配好 Cron（UTC 16:05 = 北京时间次日 0:05），
  平台会自动带 `CRON_SECRET` 调用 `/api/cron/daily`。免费版每天一次，够用。
- **Neon 免费版会休眠**：闲置后首次访问要几秒唤醒，属正常。
- **备份**：Neon 自带按时间点恢复，不用自己写备份脚本。
- **改密码**：登录后到「系统设置 → 修改密码」。`INITIAL_PASSWORD` 只在首次建库时生效，
  之后改它不会影响已设置的密码。

---

## 部署到自己的云服务器（Docker）

```bash
cat > .env <<'EOF'
POSTGRES_PASSWORD=<设一个数据库密码>
AUTH_SECRET=<openssl rand -hex 32 的结果>
INITIAL_PASSWORD=0000
CRON_SECRET=<随便一串随机字符>
TZ=Asia/Shanghai
EOF

docker compose up -d --build
docker compose logs -f
```

compose 里已内置 Postgres 服务，数据落在具名卷 `hhstudio-pgdata`，容器重建不丢。

备份：

```bash
docker compose exec db pg_dump -U hh hhstudio > backup-$(date +%F).sql
```

定时任务（应用在长驻进程下会自己跑，这条是兜底）：

```cron
5 0 * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/daily
```

反向代理（Caddy）：

```caddyfile
hh.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

用 Nginx 务必透传协议头，否则会话 Cookie 的 Secure 判断会出错：

```nginx
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header Host $host;
```

---

## 本地开发

```bash
npm install
cp .env.example .env      # 至少改 DATABASE_URL 与 AUTH_SECRET

# 没有本地 Postgres 的话，用 Docker 起一个
docker run -d --name hh-pg -p 5432:5432 \
  -e POSTGRES_USER=hh -e POSTGRES_PASSWORD=hh -e POSTGRES_DB=hhstudio \
  postgres:16-alpine

npm run dev               # http://localhost:3000
npm run seed:demo         # 可选：灌演示数据
```

---

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres 连接串。Vercel 建库后自动注入 |
| `AUTH_SECRET` | ✅ | 会话签名密钥，至少 16 字符 |
| `TZ` | ✅（云端） | 业务时区。不设会按 UTC 算「今天」，导致到期提醒差一天 |
| `INITIAL_PASSWORD` | | 首次建库时写入的登录密码，默认 `0000` |
| `CRON_SECRET` | | 每日任务端点的调用令牌 |
| `COOKIE_SECURE` | | 强制 Cookie 的 Secure 标记，默认按请求协议自动判断 |

---

## 排障：先看 `/api/health`

这个端点**不需要登录**（登录挂了才最需要它），返回：

```json
{
  "ok": true,
  "checks": {
    "databaseUrlSet": true,
    "databaseHost": "ep-xxx.ap-southeast-1.aws.neon.tech",
    "databaseReachable": true,
    "serverVersion": "PostgreSQL 16.13",
    "tz": "Asia/Shanghai",
    "orders": 29
  }
}
```

| 现象 | 处理 |
|---|---|
| `databaseUrlSet: false` | 没建数据库或没 Redeploy。见 Vercel 部署第 2、4 步 |
| `databaseReachable: false` | 看 `databaseError`：连接串写错、数据库休眠中（重试一次）、或防火墙拦了 |
| `tz` 显示未设置 | 加 `TZ=Asia/Shanghai` 后重新部署，否则日期会差一天 |

登录失败时，具体原因也会直接显示在密码框下方，不再是空白的 500 页。

---

## 项目结构

```
src/
├── app/
│   ├── (app)/              登录后的页面：看板 / 订单 / 客户 / 成本 / 报表 / 设置
│   ├── api/cron/daily/     每日任务端点（Vercel Cron 调用）
│   ├── api/health/         部署自检端点
│   ├── login/              登录页
│   ├── error.tsx           错误边界，直接显示可执行的排查建议
│   └── actions.ts          全部 Server Actions
├── components/
│   ├── QuickEntry.tsx      文字录入 + 实时解析 + 确认卡片
│   ├── ExpiringAlert.tsx   到期提醒
│   ├── AccountLoad.tsx     账号负载
│   ├── charts.tsx          手写 SVG 图表
│   └── ui.tsx              基础组件
├── lib/
│   ├── parser/             自然语言解析（纯函数，前后端共用）
│   ├── domain/             业务逻辑：订单 / 客户评分 / 成本 / 报表 / 每日任务
│   ├── db/                 Postgres schema、连接与建表
│   ├── date.ts             日期与周期计算
│   └── auth/               密码哈希与会话
└── middleware.ts           登录拦截
```

---

## 几个设计上的取舍

- **订单状态不落库**：剩余天数每次查询实时算，跨零点自动生效，不会因为定时任务没跑而显示错误。
- **毛利在平台与账号两层核算**：一个账号的成本可以同时服务多位租户，单笔订单的「毛利」没有意义。
- **成本用现金口径**：按实际支付日全额计入当期，对账直观。代价是月初刚续完会员时毛利会先显示为负，
  报表页会明确提示本期进度。若需按天摊销，见 PRD 的二期规划。
- **表结构自动创建**：首次访问时执行 `CREATE TABLE IF NOT EXISTS`，部署不需要单独跑迁移。
- **后台任务永不拖垮应用**：每日任务与调度器的异常全部兜住，只记日志 ——
  数据库出问题时首页和 `/api/health` 仍然打得开，否则排障入口会被一起端掉。
- **无第三方图表库**：图表是手写 SVG，包体小、配色可控，且保证「图例 + 数值标注 + 表格视图」
  三重可读性，不依赖颜色单独传递信息。
