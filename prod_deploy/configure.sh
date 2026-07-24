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
    case "$TLS_EMAIL" in
      *@*) ;;
      *) die "TLS_EMAIL must be an email address (got: $TLS_EMAIL)" ;;
    esac
    # Let's Encrypt rejects contacts on reserved TLDs (.local, .test, …)
    email_domain="${TLS_EMAIL##*@}"
    case "$email_domain" in
      *.*) ;;
      *) die "TLS_EMAIL domain looks invalid: $email_domain" ;;
    esac
    case "$email_domain" in
      *.local|*.test|*.invalid|*.localhost|*.example|local|test|invalid|localhost|example)
        die "TLS_EMAIL=$TLS_EMAIL — Let's Encrypt rejects this contact domain; use a real mailbox (e.g. ops@mobilon.ru)"
        ;;
    esac
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
MONITOR_USER="${MONITOR_USER:-monitor}"
MONITOR_PASSWORD="${MONITOR_PASSWORD:-$(rand_hex)}"

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

case "$MONITOR_USER" in
  ""|*[!A-Za-z0-9._-]*) die "MONITOR_USER must be non-empty alphanumeric (got: ${MONITOR_USER})" ;;
esac

# Caddy basicauth needs bcrypt (caddy hash-password / bcrypt).
# Do NOT escape $ as $$ — Caddy 2.8 keeps $2a$… bcrypt hashes literal; $$ breaks auth.
hash_monitor_password() {
  raw=""
  if command -v docker >/dev/null 2>&1; then
    raw=$(docker run --rm -e PASSWORD="$MONITOR_PASSWORD" "$CADDY_IMAGE" \
      sh -c 'caddy hash-password --plaintext "$PASSWORD"') \
      || die "failed to hash MONITOR_PASSWORD via docker ($CADDY_IMAGE)"
  elif python3 -c 'import bcrypt' 2>/dev/null; then
    raw=$(MONITOR_PASSWORD="$MONITOR_PASSWORD" python3 -c \
      'import os,bcrypt; print(bcrypt.hashpw(os.environ["MONITOR_PASSWORD"].encode(), bcrypt.gensalt(rounds=14)).decode())') \
      || die "failed to hash MONITOR_PASSWORD via python bcrypt"
  else
    die "need docker ($CADDY_IMAGE) or python3+bcrypt to hash MONITOR_PASSWORD"
  fi
  raw=$(printf '%s' "$raw" | tr -d '\r\n')
  [ -n "$raw" ] || die "empty password hash"
  printf '%s' "$raw"
}
MONITOR_PASSWORD_HASH="$(hash_monitor_password)"

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
export TPL_MONITOR_USER="$MONITOR_USER"
export TPL_MONITOR_PASSWORD_HASH="$MONITOR_PASSWORD_HASH"
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

OUT="${OUT:-$ROOT/result}"
mkdir -p "$OUT"

render templates/env "$OUT/.env"
render templates/caddy/Caddyfile "$OUT/caddy/Caddyfile"
render templates/janus/janus.plugin.sip.jcfg "$OUT/janus/janus.plugin.sip.jcfg"
render templates/janus/janus.jcfg "$OUT/janus/janus.jcfg"
render templates/janus/janus.transport.http.jcfg "$OUT/janus/janus.transport.http.jcfg"
render templates/janus/janus.transport.websockets.jcfg "$OUT/janus/janus.transport.websockets.jcfg"
# compose has no placeholders — copy as-is (paths relative to result/)
cp templates/docker-compose.yml "$OUT/docker-compose.yml"
echo "wrote $OUT/docker-compose.yml"

cat > "$OUT/SUMMARY.txt" <<EOF
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

Monitor UI basic auth (${PUBLIC_ORIGIN}/monitor/):
  user=$MONITOR_USER
  password=$MONITOR_PASSWORD

Deploy this directory (result/) to the server, then:

  cd result   # or wherever you copied it
  docker-compose up -d

Manage UI: ${PUBLIC_ORIGIN}/manage/
Demo:      ${PUBLIC_ORIGIN}/demo/
EOF

echo ""
echo "=== configure summary (also result/SUMMARY.txt) ==="
cat "$OUT/SUMMARY.txt"
echo ""
echo "output directory: $OUT"
