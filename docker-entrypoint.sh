#!/bin/sh
set -e

# 挂载进来的数据目录，属主未必是容器里的 nextjs(1001)。
# 用 bind mount（-v /srv/hh/data:/data）时宿主目录通常属于 root，
# 容器内非 root 进程就写不进去 —— 表现为「登录页能开，一登录就 500」。
# 这里以 root 起步，把目录准备好并纠正属主，再降权运行应用。

DB_PATH="${DATABASE_PATH:-/data/app.db}"
DATA_DIR="$(dirname "$DB_PATH")"
BACKUP_DIR="${BACKUP_PATH:-/data/backup}"

mkdir -p "$DATA_DIR" "$BACKUP_DIR"

if [ "$(id -u)" = "0" ]; then
  # 只在属主不对时才 chown，避免大目录每次启动都全量遍历
  if [ "$(stat -c %u "$DATA_DIR")" != "1001" ]; then
    echo "[entrypoint] 修正数据目录属主：$DATA_DIR"
    chown -R 1001:1001 "$DATA_DIR"
  fi
  if [ "$(stat -c %u "$BACKUP_DIR")" != "1001" ]; then
    chown -R 1001:1001 "$BACKUP_DIR"
  fi
  exec su-exec 1001:1001 "$@"
fi

exec "$@"
