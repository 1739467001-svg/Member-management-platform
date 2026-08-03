# ── 构建阶段 ──────────────────────────────────────────
FROM node:22-alpine AS builder

# better-sqlite3 是原生模块，Alpine 上需要编译工具链
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# 构建期不需要真实密钥，运行期由环境变量注入
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build


# ── 运行阶段 ──────────────────────────────────────────
FROM node:22-alpine AS runner

RUN apk add --no-cache tzdata su-exec && \
    addgroup -g 1001 -S nodejs && \
    adduser -u 1001 -S nextjs -G nodejs

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TZ=Asia/Shanghai \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/data/app.db \
    BACKUP_PATH=/data/backup

# standalone 产物已包含运行所需的 node_modules；
# .next/static 与 public 由 scripts/postbuild.mjs 在构建时拷入
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# 数据目录挂卷，容器重建不丢数据
RUN mkdir -p /data && chown -R nextjs:nodejs /data
VOLUME ["/data"]

EXPOSE 3000

# 以 root 进入 entrypoint 纠正挂载目录属主，随后 su-exec 降权到 1001 运行；
# 应用进程本身不是 root。
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# 健康检查打 /api/health：它会真正读写一次数据库，
# 存储坏掉时容器会被标记为 unhealthy，而不是假装还活着
HEALTHCHECK --interval=60s --timeout=8s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
