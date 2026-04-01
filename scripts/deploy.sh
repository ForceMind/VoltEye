#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not found. Please install Docker first."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin not found. Please install it first."
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

read -r -p "TCNest login mobile: " SITE_MOBILE_RAW
read -r -s -p "TCNest login password: " SITE_PASSWORD_RAW
echo
read -r -p "Polling interval minutes (default 30): " POLL_INTERVAL_RAW
read -r -p "Low balance threshold CNY (default 50): " LOW_BALANCE_RAW
read -r -p "Contract ID (optional, blank = auto): " CONTRACT_ID_RAW
read -r -p "Smart meter key (optional, blank = auto): " SMART_KEY_RAW
read -r -p "Alert webhook URL (optional): " ALERT_WEBHOOK_RAW
read -r -p "SYNC API key (blank = auto-generated): " SYNC_API_KEY_RAW
read -r -p "Preferred start port (default 3000, script auto-finds free): " BASE_PORT_RAW

if [[ -z "$SITE_MOBILE_RAW" || -z "$SITE_PASSWORD_RAW" ]]; then
  echo "Mobile and password are required."
  exit 1
fi

POLL_INTERVAL_MINUTES="${POLL_INTERVAL_RAW:-30}"
LOW_BALANCE_THRESHOLD="${LOW_BALANCE_RAW:-50}"
SYNC_API_KEY="${SYNC_API_KEY_RAW:-$(gen_api_key)}"
BASE_PORT="${BASE_PORT_RAW:-3000}"
MAX_PORT=$((BASE_PORT + 200))

if ! [[ "$BASE_PORT" =~ ^[0-9]+$ ]]; then
  echo "Start port must be numeric."
  exit 1
fi

HOST_PORT="$(find_free_port "$BASE_PORT" "$MAX_PORT" || true)"
if [[ -z "$HOST_PORT" ]]; then
  echo "No free port found in range ${BASE_PORT}-${MAX_PORT}."
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
# host port published by docker compose
HOST_PORT=$HOST_PORT

# app listens inside container on 3000
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

echo "Building and starting service..."
docker compose up -d --build

echo
echo "Deployment completed."
echo "URL: http://<server-ip>:$HOST_PORT"
echo "Manual sync endpoint: POST /api/sync (header: x-api-key)"
echo "SYNC_API_KEY: $SYNC_API_KEY"
