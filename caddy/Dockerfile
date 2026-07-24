# Legacy: local/dev and deploy use stock `caddy:2.8-alpine` + `caddy/Caddyfile`
# (reverse proxy only). Static is served by `@wosobo/static-server`.
#
# This Dockerfile is unused by docker-compose; kept only if you need a custom
# Caddy image for experiments.
FROM caddy:2.8-alpine
COPY caddy/Caddyfile /etc/caddy/Caddyfile
