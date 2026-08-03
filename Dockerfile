# ── 构建阶段 ──────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# standalone 产物：自托管才需要，Vercel 上不走这个 Dockerfile
RUN npm run build:standalone


# ── 运行阶段 ──────────────────────────────────────────
FROM node:22-alpine AS runner

RUN apk add --no-cache tzdata && \
    addgroup -g 1001 -S nodejs && \
    adduser -u 1001 -S nextjs -G nodejs

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TZ=Asia/Shanghai \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# standalone 产物已包含运行所需的 node_modules；
# .next/static 与 public 由 scripts/postbuild.mjs 在构建时拷入
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

# 数据存在 Postgres 里，容器本身无状态，不需要挂卷
USER nextjs
EXPOSE 3000

# 健康检查打 /api/health：它会真正连一次数据库，
# 数据库连不上时容器会被标记 unhealthy，而不是假装还活着
HEALTHCHECK --interval=60s --timeout=8s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
