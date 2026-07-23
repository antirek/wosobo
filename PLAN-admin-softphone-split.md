# План: админка учёток + softphone без SIP-секретов

Связанные документы: [`PLAN-janus-sip-softphone.md`](./PLAN-janus-sip-softphone.md), [`PLAN-reconnect.md`](./PLAN-reconnect.md), [`ANALYSIS-sip-register-options.md`](./ANALYSIS-sip-register-options.md).

**Статус:** S0 закрыт — продуктовые решения + контракты зафиксированы. Можно реализовывать с S1.

---

## 1. Цель

| Приложение | Кто | Что делает |
|------------|-----|------------|
| **Admin** | Администратор | Заводит ники и привязку к внешней SIP-PBX |
| **Softphone** | Сотрудник | Вход по нику → линия → только звонки |

**Жёсткое требование:** softphone **никогда** не видит SIP-учётные данные (password, username, server, authuser) — ни в UI, ни в JS, ни в softphone API / signaling.

---

## 2. Зафиксированные решения

### 2.1. Продукт

| # | Тема | Решение |
|---|------|---------|
| 1 | Softphone login | **Только ник** (без пароля приложения) |
| 2 | Admin auth | **HTTP Basic** `admin` / `admin` (env: `ADMIN_USER` / `ADMIN_PASSWORD`) |
| 3 | Кардинальность | **1 ник = 1 SIP extension** |
| 4 | UI softphone | Только ник; SIP extension/server не показываем |
| 5 | SIP secrets | Никогда в softphone → server-owned REGISTER |
| 6 | Медиа | **WebRTC browser ↔ Janus** (ICE/DTLS/RTP) |
| 7 | Signaling softphone | **Только** softphone-api (WSS). Softphone **не** открывает Janus WS |
| 8 | REGISTER | **Постоянный** (пока `enabled` и softphone-api/Janus живы) |
| 9 | Вкладки | **Одна** на ник; вторая → отказ `already_connected` (не kick) |
| 10 | Admin UI | Отдельное приложение `:3120` |
| 11 | API | Два сервиса: `admin-api` `:3121`, `softphone-api` `:3101` |

### 2.2. Реализация (дыры закрыты)

| Тема | Решение |
|------|---------|
| Layout репо | Два контейнера/папки: `admin-api/`, `softphone-api/` (текущий `api/` → softphone-api или заменить) |
| Mongo collection | `subscribers` (старую `users` не использовать в новом коде) |
| Seed | `alice`→1001/pass1001@asterisk, `bob`→1002/pass1002@asterisk, `enabled: true` |
| Softphone session | `POST /api/session` → opaque `token` (случайный), TTL **24h**; хранить в **sessionStorage** |
| Риск nick-only | Любой, кто знает ник, может войти — **принято для стенда/MVP** |
| Mute | **Локально** в softphone (`track.enabled`); в signaling не обязателен |
| Закрытие вкладки / disconnect WSS | Отвязать UI-сессию; если был звонок → **hangup** на SIP handle; REGISTER **не** снимать |
| Вторая вкладка | Ответ WS/HTTP **403/error `already_connected`** |
| Входящий без softphone | `decline` **486**, или absent-announce если `absentAnnounce` (см. [`PLAN-absent-announce.md`](./PLAN-absent-announce.md)) |
| Входящий + обрыв softphone во время ring | stop ringtone; decline/hangup best-effort; idle |
| Sync admin → line manager | **Primary:** admin-api после CRUD шлёт `POST` на внутренний URL softphone-api. **Backup:** softphone-api poll Mongo каждые **3s** |
| Always-on boot | На старте softphone-api: все `enabled` → handle + REGISTER. Не ждать первого login (S4 = сразу полный always-on) |
| Janus WS | Только softphone-api → `ws://janus:8188` (в compose). На хост `:8188` можно оставить для отладки; softphone его **не** использует |
| SIP URI helpers | `buildProxy` / `buildSipUsername` / `buildCallUri` — **только** в softphone-api |
| displayName | Опционально; если пусто → в SIP `display_name` = nick |
| admin-api publish | В compose: `127.0.0.1:3121:3121` (только localhost хоста) или без ports + доступ из admin-ui-сети |
| Admin UI → admin-api | Vite **dev proxy** `/admin-api` → admin-api (Basic с UI или proxy добавляет заголовок из env на стенде). Проще для стенда: UI шлёт Basic, API на localhost |
| CORS softphone-api | `http://localhost:3100` |
| CORS admin-api | `http://localhost:3120` |
| Monitor | Без изменений `:3110` |
| Порты | Softphone `:3100`, softphone-api `:3101`, Monitor `:3110`, Admin UI `:3120`, admin-api `:3121` |

### 2.3. Опциональные развилки (если не согласны — скажите; иначе идём с Recommended)

| Тема | Recommended | Альтернатива |
|------|-------------|--------------|
| Хранение softphone token | `sessionStorage` (закрыл вкладку → новый login) | `localStorage` (дольше жить без re-login) |
| Sync | notify + poll 3s | только poll / только Mongo change stream (нужен replica set) |
| Offline incoming | 486 Busy | 480 Temporarily Unavailable |
| admin-api на хост | bind `127.0.0.1:3121` | не публиковать port; admin-ui reverse-proxy внутри контейнера |

---

## 3. Архитектура

```
                    внутренняя сеть
┌─────────────┐     ┌──────────────┐     ┌─────────┐
│ Admin UI    │────▶│ admin-api    │────▶│ Mongo   │
│ :3120       │     │ :3121        │     │ subscr. │
│ Basic       │     │ CRUD         │     └────▲────┘
└─────────────┘     └──────┬───────┘          │
                           │ notify           │ poll backup
                           ▼                  │
┌─────────────┐     ┌──────────────┐          │
│ Softphone   │────▶│ softphone-api│──────────┘
│ :3100       │ HTTP│ :3101        │
│             │ WSS │ session +    │     ┌─────────┐
│             │────▶│ line manager │────▶│  Janus  │
│ WebRTC only │◀════│ + signaling  │ WS  │  SIP    │
└──────┬──────┘     └──────────────┘     └────┬────┘
       │ ICE / DTLS / RTP                      │
       └───────────────────────────────────────┘
                                              │ SIP
                                              ▼
                                         External PBX
```

**Важно:** softphone **не** использует `janus.js` WS к Janus. Клиент softphone: наш тонкий signaling-клиент + `RTCPeerConnection`. SDP/candidates ходят через softphone-api WSS; медиа — напрямую на Janus.

---

## 4. Постоянный REGISTER

Кратко (детали жизненного цикла — §4.6 прежние по смыслу):

- Владелец Janus SIP handle = **softphone-api**.
- Softphone presence ≠ SIP registration.
- `enabled=true` → REGISTER с boot и после CRUD notify.
- `enabled=false` / delete → unregister + destroy handle.
- Softphone disconnect → REGISTER остаётся; активный звонок → hangup.
- Нет softphone → входящий **486**.

---

## 5. Модель данных

### Subscriber (`subscribers`)

```
{
  nick: string,              // unique, normalized [a-z0-9][a-z0-9._-]{0,31}
  displayName?: string,
  enabled: boolean,
  sip: {
    server: string,          // host[:port], с точки зрения Janus
    username: string,        // extension
    password: string,
    authuser?: string,
    transport?: "udp" | "tcp" | "tls"  // default udp
  },
  createdAt: Date,
  updatedAt: Date
}
```

### SoftphoneSession (in-memory на softphone-api достаточно для MVP)

```
{
  token: string,
  nick: string,
  createdAt: number,
  expiresAt: number
}
```

Персист сессий в Mongo **не обязателен** для стенда (рестарт api → re-login).

### LineRuntime (in-memory softphone-api)

```
{
  nick,
  janusSessionId,
  janusHandleId,
  sipRegistered: boolean,
  softphoneWs: WebSocket | null,   // одна вкладка
  callPhase: "idle" | "outgoing" | "incoming" | "incall",
  pendingIncoming?: { caller: string, hasJsep: boolean }
}
```

---

## 6. Контракт: admin-api

Base: `http://127.0.0.1:3121`  
Auth: `Authorization: Basic …` на всех `/api/admin/*`  
Content-Type: `application/json`

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/health` | — | `{ ok: true }` (без auth) |
| GET | `/api/admin/subscribers` | — | `{ items: SubscriberPublic[] }` |
| GET | `/api/admin/subscribers/:nick` | — | `SubscriberPublic` |
| PUT | `/api/admin/subscribers/:nick` | `SubscriberWrite` | `SubscriberPublic` |
| PATCH | `/api/admin/subscribers/:nick` | частичные поля | `SubscriberPublic` |
| DELETE | `/api/admin/subscribers/:nick` | — | `{ ok: true }` |

**SubscriberPublic** (без password):

```json
{
  "nick": "alice",
  "displayName": "Alice",
  "enabled": true,
  "sip": {
    "server": "asterisk",
    "username": "1001",
    "authuser": null,
    "transport": "udp",
    "passwordSet": true
  },
  "createdAt": "...",
  "updatedAt": "..."
}
```

**SubscriberWrite:**

```json
{
  "displayName": "Alice",
  "enabled": true,
  "sip": {
    "server": "asterisk",
    "username": "1001",
    "password": "pass1001"
  }
}
```

Правила:

- PUT upsert по nick (normalize lowercase).
- PATCH: если `sip.password` отсутствует или `""` — **не менять** пароль.
- После успешного write/delete — fire-and-forget notify softphone-api (ошибка notify не откатывает Mongo; poll подстрахует).

**Внутренний notify (admin-api → softphone-api):**

```
POST http://softphone-api:3101/internal/lines/reconcile
Header: X-Internal-Token: <INTERNAL_TOKEN>
Body: { "nick": "alice" } | { "all": true }
```

---

## 7. Контракт: softphone-api (HTTP)

Base: `http://localhost:3101`  
Публичные маршруты **не** отдают SIP fields.

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/health` | — | — | `{ ok: true }` |
| POST | `/api/session` | — | `{ "nick": "alice" }` | `{ token, nick, expiresAt }` |
| DELETE | `/api/session` | Bearer token | — | `{ ok: true }` |
| POST | `/internal/lines/reconcile` | `X-Internal-Token` | `{ nick? , all? }` | `{ ok: true }` |

`POST /api/session`:

- 404 если nick нет или `enabled=false`
- 200 + token если ок
- **Не** проверяет «вкладка уже подключена» (это на WSS connect)

Старый `GET/PUT /api/users/:nick/sip` — **удалить** (не оставлять softphone-facing).

---

## 8. Контракт: softphone signaling (WSS)

### 8.1. Транспорт

```
WS /ws/softphone?token=<token>
```

или первый кадр `{"type":"auth","token":"..."}` — **Recommended: query token** (проще).

Лимит: **один** активный WS на nick. Вторая попытка:

```json
{ "type": "error", "code": "already_connected", "message": "Уже открыта другая вкладка" }
```

и закрытие сокета.

При connect:

1. Validate token / expiry.
2. Bind WS к `LineRuntime[nick]`.
3. Сразу отправить snapshot статуса линии.

### 8.2. Client → Server

Все сообщения — JSON object с обязательным `type`.

| type | Поля | Когда |
|------|------|--------|
| `dial` | `number: string` | Исходящий (номер или sip:uri; сервер сам достроит URI через sip.server) |
| `accept` | `jsep: RTCSessionDescriptionInit` | Ответ на входящий |
| `decline` | — | Отклонить входящий |
| `hangup` | — | Сброс исходящего / разговора |
| `update` | `jsep` | ICE restart / ответ на re-INVITE → Janus SIP `update` |
| `jsep` | `jsep` | Дополнительный SDP (редко; обычно в dial/accept) |
| `trickle` | `candidate: RTCIceCandidateInit \| null` | ICE; `null` = end-of-candidates |
| `ping` | — | keepalive app-level |

**Исходящий звонок (порядок):**

1. Softphone: `getUserMedia` → `PC.createOffer` →  
   `{ "type": "dial", "number": "1004", "jsep": { type, sdp } }`  
   (jsep можно тем же сообщением — **так и фиксируем**: `dial` несёт `jsep`).
2. Сервер → Janus `request: call` + jsep.
3. Сервер → softphone события `call_state` / `jsep` (answer) / `trickle`.

**Входящий:**

1. Сервер → `{ type: "incoming", caller, jsep? }` (+ рингтон на клиенте).
2. Softphone → `{ type: "accept", jsep: answer }` или `decline`.

### 8.3. Server → Client

| type | Поля | Смысл |
|------|------|--------|
| `hello` | `nick`, `line`, `call` | Snapshot сразу после connect |
| `line` | `status`, `detail?` | Статус SIP/линии |
| `call` | `state`, `detail?`, `caller?` | Фаза звонка |
| `incoming` | `caller`, `jsep?` | Входящий INVITE |
| `updatingcall` | `jsep?` | Remote re-INVITE — ответить `update` + answer |
| `jsep` | `jsep` | SDP от Janus (answer/offer) |
| `trickle` | `candidate` | ICE от Janus (`completed` можно отдельным флагом) |
| `error` | `code`, `message` | Ошибка |
| `pong` | — | Ответ на ping |

**line.status:**

| status | Смысл |
|--------|--------|
| `starting` | Handle поднимается |
| `registering` | Ушёл REGISTER |
| `registered` | На АТС ок (softphone может звонить) |
| `unregistering` | Снимаем линию (disable) |
| `offline` | Нет регистрации |
| `reconnecting` | Сервер чинит Janus/SIP |
| `error` | Ошибка (detail) |

**call.state:** `idle` | `outgoing` | `incoming` | `incall` | `reconnecting-media` (только UI, при ICE restart)

Пример `hello`:

```json
{
  "type": "hello",
  "nick": "alice",
  "line": { "status": "registered" },
  "call": { "state": "idle" }
}
```

**Запрещено** в любом WS/HTTP softphone payload: `password`, `secret`, `server`, `username`, `authuser`, `proxy`, raw Janus register body.

Допустимо в событиях звонка: `caller` как SIP URI или display (это не наши credentials).

### 8.4. Соответствие Janus SIP (server-side only)

| Softphone | softphone-api → Janus |
|-----------|------------------------|
| (boot / reconcile) | `register` + secret из Mongo |
| `dial` + jsep | `call` + uri + jsep |
| `accept` + jsep | `accept` + jsep |
| `decline` | `decline` |
| `hangup` | `hangup` |
| `update` | Janus SIP `update` + jsep |
| `trickle` | Janus trickle |
| — | keepalive session |
| нет softphone + incoming | `decline` code 486 |
| disable subscriber | `unregister` + destroy |

Клиент **не** шлёт `register` / `unregister`.

### 8.5. WebRTC на клиенте (обязанности softphone)

1. `RTCPeerConnection` с audio transceiver/track.
2. Local offer/answer SDP → WSS.
3. Remote SDP из событий `jsep` / `incoming`.
4. Local ICE → `trickle`; remote ICE из `trickle`.
5. `ontrack` → remote audio element.
6. Mute = `sender.track.enabled = false` (локально).
7. Не подключаться к Janus WS / не грузить janus.js для SIP (можно удалить зависимость после миграции).

---

## 9. UX

### Admin UI (`:3120`)

- Basic auth к admin-api.
- Список subscribers + create/edit/disable/delete.
- Password write-only.
- Подсказка: SIP server = hostname **из Janus** (`asterisk` на стенде).

### Softphone (`:3100`)

- Login: поле ник → `POST /api/session` → открыть WSS.
- Статусы line/call из §8.3.
- Dial / hangup / accept / decline / mute / ringtone.
- Logout: `DELETE /api/session`, закрыть WS (REGISTER остаётся).
- Нет SIP-формы.

---

## 10. Граница секретов

| Место | SIP credentials |
|-------|-----------------|
| Softphone UI/JS/storage/WS/HTTP | **Запрещены** |
| admin-api GET | password нет; server/username да |
| Mongo / softphone-api → Janus register | да |
| Логи | не писать password/secret |
| `INTERNAL_TOKEN` | shared secret между admin-api и softphone-api |

---

## 11. Этапы реализации

### S0 — закрыт

- [x] Продукт §2.1
- [x] Impl defaults §2.2
- [x] Контракты §6–§8

### S1 — admin-api + модель

- [x] `admin-api` на `:3121`, Basic, CRUD `subscribers`
- [x] Seed alice/bob
- [x] Compose: mongo + admin-api (`127.0.0.1:3121`)
- [x] Notify softphone-api

### S2 — Admin UI

- [x] Vite app `:3120`, список + форма
- [x] Работает против admin-api

### S3 — Softphone shell

- [x] Убрать SIP-форму и вызовы `/users/.../sip`
- [x] Login nick → session token

### S4 — Line manager + WSS + WebRTC

- [x] softphone-api: Janus WS client, boot REGISTER всех enabled
- [x] WSS контракт §8
- [x] Softphone: PC + dial/accept/hangup/trickle
- [x] Одна вкладка; disconnect → hangup call, keep REGISTER
- [x] reconcile notify + poll

### S5 — Входящие offline + reconnect server

- [x] Нет WS → incoming 486
- [x] Server reconnect Janus (базовый backoff в LineManager)
- [x] Softphone: auto-reconnect WSS после обрыва ([`PLAN-reconnect.md`](./PLAN-reconnect.md) R1)

### S6 — Чистка

- [x] Новый softphone path без janus.js SIP; старый `api/` не в compose
- [x] README обновлён
- [ ] Multi-tab — out of scope (отдельный план)

---

## 12. Критерий готовности

1. Админ Basic заводит ник+SIP в Admin UI / admin-api.
2. Сотрудник входит только по нику.
3. Исходящий и входящий аудио работают; media на Janus.
4. В DevTools softphone нет SIP credentials.
5. После закрытия softphone REGISTER сохраняется; без softphone входящие → 486.
6. admin-api только localhost/internal.
7. Вторая вкладка того же nick получает `already_connected`.

---

## 13. Следующий шаг

Реализация **S1 → S2**, затем **S4** (контракт §8 уже фиксирован; не изобретать другой протокол без правки этого файла).

Если нужно сменить пункт из §2.3 — напишите номер строки таблицы; иначе считаем Recommended утверждённым.
