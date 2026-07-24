# Production install (Wosobo)

На **сборочной** машине: `install.env` → `./configure.sh` → каталог **`result/`**.  
На **сервер** копируете только `result/` (+ образ `wosobo` в registry/load).  
Сборка образа: [`../build/`](../build/). SIP PBX — внешняя.

## Быстрый старт

```bash
cd prod_deploy
cp install.env.example install.env
# DOMAIN, PUBLIC_IP, TLS_*, WOSOBO_IMAGE=…

./configure.sh
# → result/  (docker-compose.yml, .env, caddy/, janus/, SUMMARY.txt)

# на сервер:
rsync -a result/ user@host:/opt/wosobo/
# на сервере:
ssh user@host 'cd /opt/wosobo && docker-compose up -d'
```

Локальная проверка без копирования:

```bash
cd result && docker-compose up -d
```

## Параметры `install.env`

| Параметр | Обязательный | Описание |
|----------|--------------|----------|
| **DOMAIN** | да | Публичное DNS-имя. Браузер: `https://DOMAIN/…`. Softphone — HTTPS (или localhost). |
| **PUBLIC_IP** | да | IP для RTP: (1) `sdp_ip` к PBX, (2) `nat_1_1_mapping` в Janus для WebRTC к браузеру. Без правильного IP ICE зависает на `checking`, звука нет. |
| **TLS_MODE** | да | `auto` — Let's Encrypt; `internal` — самоподписанный; `off` — HTTP only. |
| **TLS_EMAIL** | при `auto` | Email для ACME (Let's Encrypt). Нужен **реальный** ящик с публичным TLD — не `@test.local` / `@example.com` (LE ответит `invalidContact`). |
| **MANAGE_API_TOKEN** | нет* | Bearer manage-api / mint. Пусто → сгенерирует configure. |
| **INTERNAL_TOKEN** | нет* | Секрет manage-api ↔ phone-server. |
| **JANUS_ADMIN_SECRET** | нет* | Admin API Janus (monitor). |
| **WOSOBO_IMAGE** | нет | Тег образа ([`../build/`](../build/)). |
| **CADDY_IMAGE** | нет | Образ Caddy. |
| **HTTP_PORT** / **HTTPS_PORT** | нет | Порты Caddy на хост. |
| **JANUS_RTP_START** / **JANUS_RTP_END** | нет | UDP media (20000–20100); проброс на хосте. |
| **JANUS_BEHIND_NAT** | нет | `behind_nat` SIP-плагина. |
| **CORS_EXTRA** | нет | Доп. Origin через запятую. |
| **ABSENT_ANNOUNCE_MAX_SEC** | нет | Лимит absent-announce. |
| **CALL_CDR_TTL_SEC** | нет | TTL CDR в Mongo. |

\* Пустые секреты генерируются; смотрите `result/SUMMARY.txt`.

## Содержимое `result/` (пакет деплоя)

| Файл | Назначение |
|------|------------|
| `docker-compose.yml` | Стеки mongo / janus / caddy / wosobo |
| `.env` | Переменные compose + apps |
| `caddy/Caddyfile` | Домен + TLS |
| `janus/*.jcfg` | Janus + SIP `sdp_ip` |
| `SUMMARY.txt` | Сводка и секреты |

Шаблоны: `templates/`. После смены `install.env` — снова `./configure.sh`, затем снова скопировать `result/` на сервер и `up -d`.

## Сеть и PBX

1. DNS: `DOMAIN` → сервер.  
2. TCP 80/443 (или ваши порты).  
3. UDP `JANUS_RTP_*` на `PUBLIC_IP`.  
4. Manage: SIP абонентов = внешняя АТС.  
5. На АТС: ACL/маршрут с IP этого сервера.

## Сервисы

| Сервис | Роль |
|--------|------|
| `wosobo` | apps из образа |
| `mongo` | данные |
| `janus` | WebRTC ↔ SIP |
| `caddy` | HTTPS front |

URL: `/manage/`, `/demo/`, `/embed/softphone.js`, `/monitor/`, `/manage-api/`.

## Чеклист

- [ ] Образ: `./build/build.sh` или `docker pull`
- [ ] `install.env` + `./configure.sh`
- [ ] Скопирован `result/` на сервер
- [ ] DNS + firewall
- [ ] На сервере: `docker-compose up -d`
- [ ] Абоненты на внешней АТС
- [ ] Smoke: demo → звонок
