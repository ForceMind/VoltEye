#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "未检测到 Docker，请先安装后再执行。"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "未检测到 Docker Compose 插件，请先安装后再执行。"
  exit 1
fi

if [[ ! -f ".env" ]]; then
  echo "未找到 .env，无法更新。请先完成首次部署（scripts/deploy.sh）。"
  exit 1
fi

mkdir -p .tmp
BACKUP_FILE=".tmp/env-backup-$(date +%Y%m%d-%H%M%S).env"
cp .env "$BACKUP_FILE"

echo "已备份配置到: $BACKUP_FILE"
echo "开始更新服务镜像并重启容器（不会删除 ./data 数据卷）..."

# 只重建当前服务，不执行 down，不删除卷，避免影响历史数据
docker compose up -d --build --no-deps volteye

echo "更新完成。"
if grep -q '^HOST_PORT=' .env; then
  HOST_PORT="$(grep '^HOST_PORT=' .env | tail -n1 | cut -d '=' -f2)"
  echo "访问地址: http://<服务器IP>:${HOST_PORT}"
fi
echo "数据目录保持不变: ./data"
