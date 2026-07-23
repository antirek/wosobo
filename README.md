# Janus SIP Softphone

## Цель

Безопасно хранить **SIP-секреты** на сервере и безопасно пропускать медиа/сигналинг из **браузера на SIP PBX** — без паролей и прямого SIP в клиенте.

WebRTC-клиент можно **встроить в любое приложение**. Приложение управляет подключениями через API:

| API | Зачем |
|-----|--------|
| **manage-api** | учётные данные абонентов (ник ↔ SIP на PBX), опции (enabled, absent announce, …) |
| **phone-server** | REGISTER/линия; **HTTP API** (session/internal) + **WebSocket** сигналинг; медиа через Janus |

Клиент: embed-скрипт [`@wosobo/softphone-embed`](./packages/softphone-embed/) — short-lived token через **manage mint**, дальше WSS. SIP password в браузер **не** попадает.

Стенд: monorepo npm workspaces (`packages/`, `@wosobo/*`). Планы: [`PLAN-npm-workspaces.md`](./PLAN-npm-workspaces.md), [`PLAN-admin-softphone-split.md`](./PLAN-admin-softphone-split.md), [`PLAN-absent-announce.md`](./PLAN-absent-announce.md), [`PLAN-manage-openapi.md`](./PLAN-manage-openapi.md), [`PLAN-softphone-embed.md`](./PLAN-softphone-embed.md).

## HTTP(S) через Caddy

Все UI/API — за Caddy. Softphone нужен **secure context** для `getUserMedia` → используйте **HTTPS** или `localhost`.

В `/etc/hosts`:

```text
127.0.0.1  service
```

| URL | Куда |
|-----|------|
| https://service/demo/ | host-backend demo (ник → mint → mount) |
| https://service/embed/softphone.js | IIFE `WosoboSoftphone` |
| https://service/manage/ | manage UI (абоненты + звонки) |
| https://service/monitor/ | monitor |
| https://service/manage-api/… | manage-api |
| https://service/api/… | phone-server HTTP (health; DELETE session) |
| https://service/ws/… | phone-server WebSocket (сигналинг) |

`/softphone/` и `/embed/demo.html` редиректят на `/demo/`.

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

1. Manage: https://service/manage/ — API token `dev-manage-token`
2. Demo: https://service/demo/ — введите ник (`alice`) → backend минтает session → floating виджет
3. Наберите `1000` (Playback) или `1004` (Echo); лог — кнопка **Лог** в виджете
4. Monitor: https://service/monitor/
5. OpenAPI: https://service/manage-api/api/manage/docs

После правок UI/embed: `docker-compose up -d --build caddy softphone-demo`

### Host backend demo

Пакет [`packages/softphone-demo`](./packages/softphone-demo/) — пример вашего backend:

```text
UI (ник) → POST /demo/session → manage-api mint (MANAGE_API_TOKEN на сервере) → mount
```

```bash
curl -sk -X POST -H "Content-Type: application/json" \
  https://service/demo/session -d '{"nick":"alice"}'
```

### Embed в свою страницу

```html
<script src="https://service/embed/softphone.js"></script>
<script>
  WosoboSoftphone.mount({
    token: "...", // с вашего backend (manage mint)
    nick: "alice",
    onLine(status, detail) {},
    onCall(state, detail) {},
    onError(err) {},
  });
  // WosoboSoftphone.unmount();
</script>
```

### Mint session (host backend)

```bash
curl -sk -X POST \
  -H "Authorization: Bearer dev-manage-token" \
  -H "Content-Type: application/json" \
  https://service/manage-api/api/manage/subscribers/alice/session \
  -d '{"ttlSec":86400}'
# → { "token", "nick", "expiresAt" }
```

### Реконнект (smoke)

План: [`PLAN-reconnect.md`](./PLAN-reconnect.md).

1. Softphone online (статус «На линии»).
2. DevTools → Network → **Offline** на 10–30 с → снова Online.
3. Ожидание: статус «Переподключение…», затем снова Registered.
4. In-call (Echo `1004`), краткий offline: ICE restart → снова разговор.
5. Unmount → **не** должен авто-подключаться.

### Входящий

1. Окно A: alice (demo Mount)
2. Окно B: bob → звонок на `1001`
3. На A: Принять / Отклонить

После закрытия softphone REGISTER на PBX **остаётся** (always-on). Без softphone входящие → **486**, либо (если в Manage включено «Offline → абонент отсутствует») server-side проигрывается фраза из `packages/phone-server/media/absent.wav`, затем hangup.

### Анонс «абонент отсутствует»

План: [`PLAN-absent-announce.md`](./PLAN-absent-announce.md).

1. Manage → абонент → «Offline → абонент отсутствует» = да.
2. Softphone этого ника **закрыть** (REGISTER останется).
3. Позвонить на его extension с другого softphone.
4. Слышен тон/фраза (~2 с), затем сброс.

## Тестовые extensions Asterisk

| Ext | Действие |
|-----|----------|
| 1001 / pass1001 | alice |
| 1002 / pass1002 | bob |
| 1000 | Playback |
| 1004 | Echo |

SIP server в manage — hostname **с точки зрения Janus** (`asterisk` на стенде).

## API (кратко)

- **manage-api** — Bearer `MANAGE_API_TOKEN`, `CRUD /api/manage/subscribers`, mint `POST /api/manage/subscribers/{nick}/session`, CDR `GET /api/manage/calls`, docs `/api/manage/docs`
- **phone-server** — HTTP `:3101` (`DELETE /api/session`, `/internal/…`); WebSocket `:3102` (`/ws/softphone?token=…&nick=…`)
- **embed** — `GET /embed/softphone.js` → `WosoboSoftphone.mount({ token, nick })`
- **softphone-demo** — пример host: `POST /demo/session` (mint через manage token)
