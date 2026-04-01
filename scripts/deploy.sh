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

escape_env() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

gen_api_key() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
    return
  fi
  head -c 24 /dev/urandom | xxd -p -c 24
}

is_port_in_use() {
  local port="$1"

  if command -v ss >/dev/null 2>&1; then
    ss -ltn | awk '{print $4}' | grep -E "[:.]${port}$" -q
    return $?
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | awk '{print $9}' | grep -E ":${port}$" -q
    return $?
  fi

  if command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk '{print $4}' | grep -E "[:.]${port}$" -q
    return $?
  fi

  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
    return $?
  fi

  (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1
}

find_free_port() {
  local start_port="$1"
  local end_port="$2"
  local p

  for ((p = start_port; p <= end_port; p++)); do
    if ! is_port_in_use "$p"; then
      echo "$p"
      return 0
    fi
  done

  return 1
}

read -r -p "请输入唐巢登录手机号: " SITE_MOBILE_RAW
read -r -s -p "请输入唐巢登录密码: " SITE_PASSWORD_RAW
echo
read -r -p "采集间隔（分钟，默认 30）: " POLL_INTERVAL_RAW
read -r -p "低余额阈值（元，默认 50）: " LOW_BALANCE_RAW
read -r -p "合同 ID（可选，留空自动识别）: " CONTRACT_ID_RAW
read -r -p "电表 KEY（可选，留空自动识别）: " SMART_KEY_RAW
read -r -p "告警 Webhook 地址（可选）: " ALERT_WEBHOOK_RAW
read -r -p "手动同步 API Key（留空自动生成）: " SYNC_API_KEY_RAW
read -r -p "起始端口（默认 3000，脚本会自动找空闲端口）: " BASE_PORT_RAW

if [[ -z "$SITE_MOBILE_RAW" || -z "$SITE_PASSWORD_RAW" ]]; then
  echo "手机号和密码不能为空。"
  exit 1
fi

POLL_INTERVAL_MINUTES="${POLL_INTERVAL_RAW:-30}"
LOW_BALANCE_THRESHOLD="${LOW_BALANCE_RAW:-50}"
SYNC_API_KEY="${SYNC_API_KEY_RAW:-$(gen_api_key)}"
BASE_PORT="${BASE_PORT_RAW:-3000}"
MAX_PORT=$((BASE_PORT + 200))

if ! [[ "$BASE_PORT" =~ ^[0-9]+$ ]]; then
  echo "起始端口必须是数字。"
  exit 1
fi

HOST_PORT="$(find_free_port "$BASE_PORT" "$MAX_PORT" || true)"
if [[ -z "$HOST_PORT" ]]; then
  echo "在 ${BASE_PORT}-${MAX_PORT} 范围内未找到可用端口。"
  exit 1
fi

SITE_MOBILE="$(escape_env "$SITE_MOBILE_RAW")"
SITE_PASSWORD="$(escape_env "$SITE_PASSWORD_RAW")"
CONTRACT_ID="$(escape_env "$CONTRACT_ID_RAW")"
SMART_KEY="$(escape_env "$SMART_KEY_RAW")"
ALERT_WEBHOOK_URL="$(escape_env "$ALERT_WEBHOOK_RAW")"
SYNC_API_KEY_ESCAPED="$(escape_env "$SYNC_API_KEY")"

mkdir -p data

cat > .env <<EOF
# Docker 对外端口（自动探测空闲端口）
HOST_PORT=$HOST_PORT

# 容器内服务端口固定 3000
PORT=3000
TZ=Asia/Shanghai

SITE_MOBILE="$SITE_MOBILE"
SITE_PASSWORD="$SITE_PASSWORD"

POLL_INTERVAL_MINUTES=$POLL_INTERVAL_MINUTES
LOW_BALANCE_THRESHOLD=$LOW_BALANCE_THRESHOLD

CONTRACT_ID="$CONTRACT_ID"
SMART_KEY="$SMART_KEY"

ALERT_WEBHOOK_URL="$ALERT_WEBHOOK_URL"
ALERT_COOLDOWN_HOURS=6

SYNC_API_KEY="$SYNC_API_KEY_ESCAPED"
MAX_RECORDS=10000
DATA_FILE=./data/balance-history.json
EOF

chmod 600 .env

echo "开始构建并启动服务..."
docker compose up -d --build

echo
echo "部署完成。"
echo "访问地址: http://<服务器IP>:$HOST_PORT"
echo "手动采集接口: POST /api/sync（请求头携带 x-api-key）"
echo "SYNC_API_KEY: $SYNC_API_KEY"
