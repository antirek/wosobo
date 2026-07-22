# Janus SIP Softphone (admin + softphone split)

Админка заводит ники и SIP-привязку к PBX. Softphone — только звонки по нику, **без SIP-секретов** в браузере.

План: [`PLAN-admin-softphone-split.md`](./PLAN-admin-softphone-split.md).

## HTTP(S) через Caddy

Все UI/API — за Caddy. Softphone нужен **secure context** для `getUserMedia` → используйте **HTTPS** или `localhost`.

В `/etc/hosts`:

```text
127.0.0.1  service
```

| URL | Куда |
|-----|------|
| https://service/softphone/ | softphone (рекомендуется) |
| http://localhost/softphone/ | softphone (тоже OK: localhost = secure) |
| https://service/admin/ | admin UI |
| https://service/monitor/ | monitor |
| https://service/admin-api/… | admin-api |
| https://service/api/… , `/ws/…` | softphone-api |

`http://service/...` **не** даёт микрофон в браузере — Caddy редиректит на HTTPS.

Наружу (кроме Caddy):

| Порт | Зачем |
|------|--------|
| `:80`, `:443` | Caddy |
| `5060`, `10000–10099/udp` | Asterisk SIP/RTP |
| `20000–20100/udp` | Janus WebRTC media |

TLS: внутренний сертификат Caddy (`tls internal`). В браузере один раз принять предупреждение о сертификате.

## Быстрый старт

```bash
echo '127.0.0.1 service' | sudo tee -a /etc/hosts
docker-compose up -d --build
```

1. Admin: https://service/admin/ — Basic `admin` / `admin`
2. Softphone: https://service/softphone/ — `alice`
3. Наберите `1000` (Playback) или `1004` (Echo)
4. Monitor: https://service/monitor/

После правок UI: `docker-compose up -d --build caddy`

### Реконнект (smoke)

План: [`PLAN-reconnect.md`](./PLAN-reconnect.md).

1. Softphone online (статус «На линии»).
2. DevTools → Network → **Offline** на 10–30 с → снова Online.
3. Ожидание: статус «Переподключение…», затем снова line snapshot / Registered; лог `signaling connected`.
4. In-call (Echo `1004`), краткий Offline: лог `ICE restart` / UI «Восстановление медиа…» → снова разговор; если не вышло — hangup.
5. Logout → **не** должен авто-подключаться.

### Входящий

1. Окно A: `alice`
2. Окно B: `bob` → звонок на `1001`
3. На A: Принять / Отклонить

После закрытия softphone REGISTER на PBX **остаётся** (always-on). Без открытого softphone входящие → 486.

## Тестовые extensions Asterisk

| Ext | Действие |
|-----|----------|
| 1001 / pass1001 | alice |
| 1002 / pass1002 | bob |
| 1000 | Playback |
| 1004 | Echo |

SIP server в админке — hostname **с точки зрения Janus** (`asterisk` на стенде).

## API (кратко)

- **admin-api** Basic: `CRUD /api/admin/subscribers`
- **softphone-api**: `POST /api/session`, WSS `/ws/softphone?token=…`
