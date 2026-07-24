# Production install (Wosobo)

Шаблон **выкладки на сервер**: готовый образ **`wosobo`**, Mongo, Janus, Caddy.  
Сборка образа — отдельно: [`../build/`](../build/).  
SIP PBX / Asterisk — **внешний** (не входит в compose).

## Быстрый старт

```bash
cd prod_deploy

cp install.env.example install.env
# DOMAIN, PUBLIC_IP, TLS_*, WOSOBO_IMAGE=…

./configure.sh
# → .env, caddy/Caddyfile, janus/*.jcfg

# образ должен быть доступен (registry или локально из ../build/)
docker-compose --env-file .env up -d
# из корня репо:
# docker-compose -f prod_deploy/docker-compose.yml --env-file prod_deploy/.env up -d
```

После `configure.sh` — `.configure-summary.txt` (токены), в `.gitignore`.

DNS: `DOMAIN` → `PUBLIC_IP`.  
Firewall: TCP `HTTP_PORT`/`HTTPS_PORT`, UDP `JANUS_RTP_*`.

## Параметры `install.env`

| Параметр | Обязательный | Описание |
|----------|--------------|----------|
| **DOMAIN** | да | Публичное DNS-имя хоста. Браузер: `https://DOMAIN/…`. Softphone нужен secure context (HTTPS или localhost). |
| **PUBLIC_IP** | да | IP, который видит **внешняя PBX** как адрес Janus для RTP (`sdp_ip`). Обычно белый IP сервера / DNAT. Не Docker bridge. |
| **TLS_MODE** | да | `auto` — Let's Encrypt; `internal` — самоподписанный; `off` — HTTP only (микрофон в браузере обычно не работает). |
| **TLS_EMAIL** | при `auto` | Email для ACME. |
| **MANAGE_API_TOKEN** | нет* | Bearer manage-api / mint. Пусто → сгенерирует `configure.sh`. |
| **INTERNAL_TOKEN** | нет* | Секрет manage-api ↔ phone-server. Пусто → сгенерирует. |
| **JANUS_ADMIN_SECRET** | нет* | Admin API Janus (monitor). Пусто → сгенерирует. |
| **WOSOBO_IMAGE** | нет | Тег образа приложения (результат [`../build/`](../build/)). |
| **CADDY_IMAGE** | нет | Образ Caddy (`caddy:2.8-alpine`). |
| **HTTP_PORT** / **HTTPS_PORT** | нет | Порты Caddy на хост (80/443). |
| **JANUS_RTP_START** / **JANUS_RTP_END** | нет | UDP media (по умолчанию 20000–20100); проброс + `rtp_port_range` Janus. |
| **JANUS_BEHIND_NAT** | нет | `true`/`false` — `behind_nat` SIP-плагина. |
| **CORS_EXTRA** | нет | Доп. Origin через запятую. Всегда есть `https://DOMAIN` (или `http://` при `off`). |
| **ABSENT_ANNOUNCE_MAX_SEC** | нет | Лимит announce «абонент отсутствует». |
| **CALL_CDR_TTL_SEC** | нет | TTL CDR в Mongo (секунды). |

\* Пустые секреты — случайные при каждом `./configure.sh`; сохраните summary / `.env`.

## Что генерирует `configure.sh`

| Файл | Назначение |
|------|------------|
| `.env` | Compose + env контейнера `wosobo` |
| `caddy/Caddyfile` | Домен + TLS, reverse proxy |
| `janus/janus.plugin.sip.jcfg` | `sdp_ip`, RTP, `behind_nat` |
| `janus/janus.jcfg` | в т.ч. `admin_secret` |
| `janus/janus.transport.*.jcfg` | CORS `allow_origin` |
| `.configure-summary.txt` | Сводка + секреты |

Шаблоны: `templates/`. После правок `install.env` — снова `./configure.sh`.

## Сеть и PBX

1. DNS: `DOMAIN` → сервер.
2. TCP 80/443 (или ваши порты) — Caddy / ACME.
3. UDP `JANUS_RTP_*` — media на `PUBLIC_IP`.
4. Manage: SIP host абонентов = **внешняя** АТС (доступна из контейнера `janus`).
5. На АТС: разрешить REGISTER/INVITE с IP этого сервера.

## Сервисы compose

| Сервис | Роль |
|--------|------|
| `wosobo` | apps из образа (см. build) |
| `mongo` | данные |
| `janus` | WebRTC ↔ SIP |
| `caddy` | HTTPS front |

URL (`PUBLIC_ORIGIN`): `/manage/`, `/demo/`, `/embed/softphone.js`, `/monitor/`, `/manage-api/`.

## Чеклист

- [ ] Образ собран/запушен: `PUSH=0 ./build/build.sh` (из корня репо) или `docker pull …`
- [ ] `install.env` (`DOMAIN`, `PUBLIC_IP`, `TLS_MODE`, `WOSOBO_IMAGE`)
- [ ] `./configure.sh`
- [ ] DNS + firewall (TCP + UDP RTP)
- [ ] `docker-compose --env-file .env up -d`
- [ ] Абоненты в Manage на внешней АТС
- [ ] Smoke: demo → «На линии», звонок
