# Deploy: image `wosobo` + compose template

## Что в image

Образ **`wosobo`** (см. `Dockerfile`) поднимает через supervisord:

| Процесс | Порт внутри контейнера |
|---------|-------------------------|
| phone-server HTTP | 3101 |
| phone-server WSS | 3102 |
| monitor | 3110 |
| manage-api | 3121 |
| softphone-demo | 3130 |
| **static-server** (embed + manage UI) | **3140** |

Статика собирается в image (`softphone-embed`, `manage-web`) и отдаётся процессом `static-server`.

**Не** входит в image: MongoDB, Asterisk, Janus, Caddy.

Caddy в deploy — **только reverse proxy** (`caddy:2.8-alpine` + общий [`caddy/Caddyfile`](../caddy/Caddyfile)). Network aliases у `wosobo`: `phone-server`, `manage-api`, `monitor`, `softphone-demo`, `static`.

## Запуск

Из **корня репозитория**:

```bash
cp deploy/.env.example deploy/.env
# токены, CORS; для прода — janus/janus.plugin.sip.jcfg → sdp_ip

# сначала image, потом compose (compose не билдит wosobo)
./deploy/docker-build.sh
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d
```

Сборка image:

```bash
./deploy/docker-build.sh
# PUSH=0 ./deploy/docker-build.sh
# IMAGE=antirek/wosobo:0.0.2 ./deploy/docker-build.sh
```

Context всегда **корень репозитория**.

## Конфиги PBX / Janus

Монтируются из репозитория (`../asterisk`, `../janus`). Перед выкладкой:

- `janus/janus.plugin.sip.jcfg` → `sdp_ip`
- при необходимости `asterisk/*.conf`

Caddyfile: общий [`caddy/Caddyfile`](../caddy/Caddyfile) (монтируется в контейнер caddy).

## Проверка

```bash
curl -sk https://service/embed/softphone.js | head -c 80
curl -sk -o /dev/null -w '%{http_code}\n' https://service/manage/
curl -sk https://service/api/health
```

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs -f wosobo
```
