#!/bin/sh
set -eu

# Fixed in-container ports (Caddy reaches us via network aliases).
export PHONE_SERVER_PORT="${PHONE_SERVER_PORT:-3101}"
export PHONE_SERVER_WS_PORT="${PHONE_SERVER_WS_PORT:-3102}"
export MANAGE_API_PORT="${MANAGE_API_PORT:-3121}"
export MONITOR_PORT="${MONITOR_PORT:-3110}"
export SOFTPHONE_DEMO_PORT="${SOFTPHONE_DEMO_PORT:-3130}"
export STATIC_PORT="${STATIC_PORT:-3140}"

# Loopback URLs between processes in this image
export PHONE_SERVER_URL="${PHONE_SERVER_URL:-http://127.0.0.1:${PHONE_SERVER_PORT}}"
export MANAGE_API_URL="${MANAGE_API_URL:-http://127.0.0.1:${MANAGE_API_PORT}}"
export STATIC_ROOT="${STATIC_ROOT:-/opt/wosobo/static}"

# Defaults so supervisord %(ENV_*)s always resolve
export MONGODB_URI="${MONGODB_URI:-mongodb://mongo:27017/janus_softphone}"
export CORS_ORIGIN="${CORS_ORIGIN:-https://service,http://localhost}"
export JANUS_WS_URL="${JANUS_WS_URL:-ws://janus:8188}"
export INTERNAL_TOKEN="${INTERNAL_TOKEN:-dev-internal-token}"
export MANAGE_API_TOKEN="${MANAGE_API_TOKEN:?MANAGE_API_TOKEN is required}"
export OPENAPI_SERVER_URL="${OPENAPI_SERVER_URL:-/manage-api}"
export ABSENT_ANNOUNCE_FILE="${ABSENT_ANNOUNCE_FILE:-/opt/wosobo/phone-server/media/absent.wav}"
export ABSENT_ANNOUNCE_MAX_SEC="${ABSENT_ANNOUNCE_MAX_SEC:-30}"
export CALL_CDR_TTL_SEC="${CALL_CDR_TTL_SEC:-172800}"
export JANUS_ADMIN_URL="${JANUS_ADMIN_URL:-http://janus:7088/admin}"
export JANUS_ADMIN_SECRET="${JANUS_ADMIN_SECRET:-janusoverlord}"

exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
