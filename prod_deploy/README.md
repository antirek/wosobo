# Production deploy: image `wosobo` + compose template

## Что в image

Образ **`wosobo`** (см. `Dockerfile`) поднимает через supervisord:

| Процесс | Порт |
|---------|------|
| phone-server HTTP / WSS | 3101 / 3102 |
| monitor | 3110 |
| manage-api | 3121 |
| softphone-demo | 3130 |
| static-server (embed + manage) | 3140 |

**В compose:** MongoDB, Janus, Caddy.  
**Снаружи:** SIP PBX. Локальный стенд с тестовым Asterisk — [`../dev_local/`](../dev_local/).

Caddy — reverse proxy (`caddy:2.8-alpine` + [`Caddyfile`](./Caddyfile)). Aliases у `wosobo`: `phone-server`, `manage-api`, `monitor`, `softphone-demo`, `static`.

## Запуск

Из **корня репозитория**:

```bash
cp prod_deploy/.env.example prod_deploy/.env
# токены, CORS; prod_deploy/janus/janus.plugin.sip.jcfg → sdp_ip
# Manage: SIP host = внешняя АТС (доступна из контейнера janus)

./prod_deploy/docker-build.sh
docker compose -f prod_deploy/docker-compose.yml --env-file prod_deploy/.env up -d
```

```bash
PUSH=0 ./prod_deploy/docker-build.sh
IMAGE=antirek/wosobo:0.0.2 ./prod_deploy/docker-build.sh
```

## Конфиги

- [`janus/`](./janus/) — production Janus (правите `sdp_ip` и т.д.)
- [`Caddyfile`](./Caddyfile) — front door

## Проверка

```bash
curl -sk https://service/embed/softphone.js | head -c 80
curl -sk https://service/api/health
docker compose -f prod_deploy/docker-compose.yml --env-file prod_deploy/.env logs -f wosobo
```
