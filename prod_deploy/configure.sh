#!/bin/sh
# Render production configs from templates/ + install.env
set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
cd "$ROOT"

INSTALL_ENV="${INSTALL_ENV:-$ROOT/install.env}"
if [ ! -f "$INSTALL_ENV" ]; then
  echo "Missing $INSTALL_ENV" >&2
  echo "  cp install.env.example install.env && edit it, then ./configure.sh" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
# strip CRLF / comments-only lines via sourcing
# shellcheck source=/dev/null
. "$INSTALL_ENV"
set +a

die() { echo "configure: $*" >&2; exit 1; }

[ -n "${DOMAIN:-}" ] || die "DOMAIN is required"
[ -n "${PUBLIC_IP:-}" ] || die "PUBLIC_IP is required"
case "${TLS_MODE:-}" in
  internal|auto|off) ;;
  *) die "TLS_MODE must be internal|auto|off (got: ${TLS_MODE:-})" ;;
esac
case "${TLS_MODE}" in
  auto)
    [ -n "${TLS_EMAIL:-}" ] || die "TLS_EMAIL is required when TLS_MODE=auto"
    ;;
esac

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
  else
    dd if=/dev/urandom bs=24 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n'
  fi
}

MANAGE_API_TOKEN="${MANAGE_API_TOKEN:-$(rand_hex)}"
INTERNAL_TOKEN="${INTERNAL_TOKEN:-$(rand_hex)}"
JANUS_ADMIN_SECRET="${JANUS_ADMIN_SECRET:-$(rand_hex)}"

WOSOBO_IMAGE="${WOSOBO_IMAGE:-antirek/wosobo:latest}"
CADDY_IMAGE="${CADDY_IMAGE:-caddy:2.8-alpine}"
HTTP_PORT="${HTTP_PORT:-80}"
HTTPS_PORT="${HTTPS_PORT:-443}"
JANUS_RTP_START="${JANUS_RTP_START:-20000}"
JANUS_RTP_END="${JANUS_RTP_END:-20100}"
JANUS_BEHIND_NAT="${JANUS_BEHIND_NAT:-false}"
ABSENT_ANNOUNCE_MAX_SEC="${ABSENT_ANNOUNCE_MAX_SEC:-30}"
CALL_CDR_TTL_SEC="${CALL_CDR_TTL_SEC:-172800}"
CORS_EXTRA="${CORS_EXTRA:-}"

case "$TLS_MODE" in
  off) PUBLIC_ORIGIN="http://${DOMAIN}" ;;
  *) PUBLIC_ORIGIN="https://${DOMAIN}" ;;
esac

if [ -n "$CORS_EXTRA" ]; then
  CORS_ORIGIN="${PUBLIC_ORIGIN},${CORS_EXTRA}"
else
  CORS_ORIGIN="${PUBLIC_ORIGIN}"
fi

# Caddy blocks (multiline → placeholders via temp files + python)
case "$TLS_MODE" in
  internal)
    CADDY_GLOBAL=$(printf '{\n\tlocal_certs\n}')
    CADDY_SITE=$(printf '%s {\n\ttls internal\n\timport app\n}' "$DOMAIN")
    ;;
  auto)
    CADDY_GLOBAL=$(printf '{\n\temail %s\n}' "$TLS_EMAIL")
    CADDY_SITE=$(printf '%s {\n\timport app\n}' "$DOMAIN")
    ;;
  off)
    CADDY_GLOBAL=""
    CADDY_SITE=$(printf 'http://%s {\n\timport app\n}' "$DOMAIN")
    ;;
esac

export TPL_DOMAIN="$DOMAIN"
export TPL_PUBLIC_IP="$PUBLIC_IP"
export TPL_PUBLIC_ORIGIN="$PUBLIC_ORIGIN"
export TPL_CORS_ORIGIN="$CORS_ORIGIN"
export TPL_MANAGE_API_TOKEN="$MANAGE_API_TOKEN"
export TPL_INTERNAL_TOKEN="$INTERNAL_TOKEN"
export TPL_JANUS_ADMIN_SECRET="$JANUS_ADMIN_SECRET"
export TPL_WOSOBO_IMAGE="$WOSOBO_IMAGE"
export TPL_CADDY_IMAGE="$CADDY_IMAGE"
export TPL_HTTP_PORT="$HTTP_PORT"
export TPL_HTTPS_PORT="$HTTPS_PORT"
export TPL_JANUS_RTP_START="$JANUS_RTP_START"
export TPL_JANUS_RTP_END="$JANUS_RTP_END"
export TPL_JANUS_BEHIND_NAT="$JANUS_BEHIND_NAT"
export TPL_ABSENT_ANNOUNCE_MAX_SEC="$ABSENT_ANNOUNCE_MAX_SEC"
export TPL_CALL_CDR_TTL_SEC="$CALL_CDR_TTL_SEC"
export TPL_CADDY_GLOBAL="$CADDY_GLOBAL"
export TPL_CADDY_SITE="$CADDY_SITE"

render() {
  src="$1"
  dst="$2"
  mkdir -p "$(dirname "$dst")"
  python3 - "$src" "$dst" <<'PY'
import os, sys, re
src, dst = sys.argv[1], sys.argv[2]
text = open(src, encoding="utf-8").read()
for k, v in os.environ.items():
    if k.startswith("TPL_"):
        text = text.replace("__" + k[4:] + "__", v)
left = sorted(set(re.findall(r"__[A-Z][A-Z0-9_]*__", text)))
if left:
    sys.stderr.write("configure: unresolved placeholders in %s: %s\n" % (src, ", ".join(left)))
    sys.exit(1)
open(dst, "w", encoding="utf-8").write(text)
print("wrote", dst)
PY
}

command -v python3 >/dev/null 2>&1 || die "python3 is required for configure.sh"

render templates/env .env
render templates/caddy/Caddyfile caddy/Caddyfile
render templates/janus/janus.plugin.sip.jcfg janus/janus.plugin.sip.jcfg
render templates/janus/janus.jcfg janus/janus.jcfg
render templates/janus/janus.transport.http.jcfg janus/janus.transport.http.jcfg
render templates/janus/janus.transport.websockets.jcfg janus/janus.transport.websockets.jcfg

# Save secrets echo for operator (also in .env)
cat > .configure-summary.txt <<EOF
configure OK ($(date -Iseconds 2>/dev/null || date))

DOMAIN=$DOMAIN
PUBLIC_IP=$PUBLIC_IP
PUBLIC_ORIGIN=$PUBLIC_ORIGIN
TLS_MODE=$TLS_MODE
CORS_ORIGIN=$CORS_ORIGIN
JANUS RTP UDP: ${JANUS_RTP_START}-${JANUS_RTP_END} → host (forward from PBX/Internet)

MANAGE_API_TOKEN=$MANAGE_API_TOKEN
INTERNAL_TOKEN=$INTERNAL_TOKEN
JANUS_ADMIN_SECRET=$JANUS_ADMIN_SECRET

Next:
  docker compose -f docker-compose.yml --env-file .env up -d
  # or from repo root:
  # docker compose -f prod_deploy/docker-compose.yml --env-file prod_deploy/.env up -d

Manage UI: ${PUBLIC_ORIGIN}/manage/
Demo:      ${PUBLIC_ORIGIN}/demo/
EOF

echo ""
echo "=== configure summary ==="
cat .configure-summary.txt
echo ""
echo "(summary also in .configure-summary.txt — keep secrets private)"
