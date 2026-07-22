# План: реконнект softphone (браузер ↔ softphone-api ↔ Janus ↔ SIP)

Связан с [`PLAN-admin-softphone-split.md`](./PLAN-admin-softphone-split.md).  
Старый путь «браузер → Janus WS» **устарел**: SIP/REGISTER владеет **softphone-api**.

---

## 1. Зачем

После обрыва сети softphone не должен оставаться «зомби»: ложный Registered, вечный звонок, мёртвый WSS без авто-восстановления.

---

## 2. Три независимых канала (актуально)

```
Браузер
  ├─ (A) WSS  →  softphone-api          ← signaling UI (dial/accept/trickle)
  ├─ (B) WebRTC → Janus media           ← аудио звонка
  └─ (косвенно, server-owned)
       softphone-api → Janus SIP → PBX  ← REGISTER / INVITE
```

| Канал | Владелец | Что ломается | Как чинить |
|-------|----------|--------------|------------|
| **A. Softphone WSS** | браузер | обрыв signaling UI | авто-reconnect WSS + token; ping/pong |
| **B. WebRTC** | браузер ↔ Janus | ICE failed / no audio | MVP: hangup; позже ICE restart |
| **C. Janus/SIP** | softphone-api | WS Janus / unregistered | уже есть: LineManager backoff + re-REGISTER |

**REGISTER не зависит от вкладки** (always-on). Обрыв softphone WSS → сервер hangup активного звонка, REGISTER **остаётся**.

---

## 3. Целевое поведение

### 3.1. Не в звонке (UI online)

| Обрыв | Ожидание |
|-------|----------|
| Короткий glitch WSS | Статус `reconnecting` → снова `hello` / line snapshot |
| Долгий offline | Backoff; при появлении сети — снова WSS |
| Logout / другая вкладка (`already_connected`) | **Не** реконнектить |

### 3.2. В активном звонке

| Обрыв | Ожидание |
|-------|----------|
| Упал softphone WSS | Сервер hangup SIP; клиент → idle + reconnect WSS; линия REGISTER ок |
| ICE `failed` (WSS жив) | Local hangup + «Связь потеряна»; линия остаётся Registered |
| Janus disconnected на сервере | LineManager reconnect; UI `line: reconnecting` если WSS ещё открыт |

Не сохраняем тот же SIP Call-ID после смерти Janus session.

### 3.3. Входящий (ringing)

- Обрыв WSS / Offline: стоп рингтон, idle; после WSS — снова можем принимать новые.

---

## 4. Статусы UI

| line.status | Смысл |
|-------------|--------|
| `registered` | SIP ок (с сервера) |
| `reconnecting` | Чинится WSS **или** сервер чинит Janus/SIP |
| `offline` | Нет signaling / исчерпаны попытки / logout |
| `error` | Ошибка |

| call.state | Смысл |
|-----------|--------|
| `idle` / `outgoing` / `incoming` / `incall` | как в контракте §8 |
| (MVP) без `reconnecting-media` | при ICE fail → hangup → idle |

---

## 5. Технический дизайн

### 5.1. Клиент (A) — softphone WSS

```
wantConnected = true  (после login; false на destroy/logout)

onWssClose (unexpected):
  local call → idle (ringtone stop; PC cleanup)
  if !wantConnected → stop
  if closeCode in {4001 unauthorized, 4003 already_connected} → stop + UI error
  else:
    onLine(reconnecting)
    backoff (1s, 2s, 5s, 10s, max 30s + jitter)
    openWs(token)
    on hello → sync line/call from server

keepalive: client ping каждые 20s; server уже отвечает pong
visibilitychange / online → если wantConnected и WS не OPEN → reconnect now
```

Token в `sessionStorage` + **Mongo `softphone_sessions`** (TTL 24h) — переживает рестарт softphone-api.
При 4001: клиент делает silent `POST /api/session` и снова открывает WSS (не выкидывает на login, пока ник валиден).
При 4002 (`no_line`): обычный backoff — ждём boot REGISTER после рестарта API.

### 5.2. Сервер (C) — уже реализовано

- Janus `_disconnected` / `registration_failed` / unexpected `unregistered` → `_scheduleReconnect`
- Keepalive Janus session 10s; `session_timeout=300`
- Softphone detach → hangup call, keep REGISTER
- Incoming без softphone → 486

### 5.3. Медиа (B)

```
ice disconnected → timer 5s
ice/connection failed или timer:
  if !iceRestartTried:
    createOffer({ iceRestart: true }) → WSS type:update → Janus SIP update
    wait answer jsep + ICE connected (timeout 12s)
  else → hangup + «Связь потеряна»

remote updatingcall → createAnswer → type:update
```

UI: `call.state = reconnecting-media` на время restart.

### 5.4. Гонки

- Один reconnect supervisor на клиенте (`reconnectInFlight` / timer).
- `destroy()` отменяет timers, `wantConnected=false`.
- Late messages от старого WS игнорировать (`ws !== current`).

---

## 6. Этапы

### R0 — Наблюдаемость

- [x] Логи WS / ICE / line на клиенте и сервере
- [x] Janus `session_timeout=300`, keepalive 10s (сервер)
- [x] README: softphone URL + DevTools Offline checklist

### R1 — Авто WSS + честный звонок

- [x] Клиент: `wantConnected`, backoff reconnect, ping
- [x] Permanent close codes → без reconnect
- [x] При потере WSS / ICE fail → local idle + hangup
- [x] `online` / `visibilitychange` → resume

**Exit:** Registered UI → DevTools Offline 30–90 с → Online → без кликов снова hello/Registered; звонок не зависает.

### R2 — (не нужен как «Janus reclaim»)

Reclaim Janus session из браузера **не применим**. Серверный reconnect = аналог R2.

- [x] LineManager backoff re-REGISTER

### R3 — Медиа

- [x] ICE restart / SIP `update` (одна попытка на звонок)
- [x] `reconnecting-media` в UI
- [x] Ответ на remote `updatingcall`

### R4 — Полировка

- [x] Кнопка «Подключить снова»
- [x] Jittered backoff (1s…30s)
- [x] Smoke в README
- [ ] Min interval между reconnect (достаточно backoff)

---

## 7. Тест-план

| # | Сценарий | Ожидание |
|---|----------|----------|
| T1 | UI online, Offline 5 с, Online | WSS reconnect → hello / Registered |
| T2 | Offline 90 с, Online | Backoff, затем Registered UI |
| T3 | In-call, Offline | Звонок idle; после Online — Registered, можно снова звонить |
| T4 | In-call, ICE fail (без Offline) | Hangup + сообщение; линия Registered |
| T5 | Incoming + Offline | Рингтон стоп, idle |
| T6 | Logout | Не реконнектит |
| T7 | Вторая вкладка | `already_connected`, первая не должна убить вторую бесконечным reconnect |

Инструменты: DevTools Offline; https://service/monitor/; softphone https://service/softphone/.

---

## 8. Риски

1. Без TURN смена сети часто = ICE fail → hangup (ожидаемо на MVP).
2. Token TTL 24h — после expiry reconnect получит 4001 → re-login.
3. REGISTER на сервере может быть up, пока UI ещё `reconnecting` — это нормально.
4. Always-on без вкладки — уже есть; этот план про **UI signaling**, не про режим B.

---

## 9. Вне скоупа

- Seamless восстановление того же SIP-диалога после смерти Janus.
- Multi-tab softphone.
- ICE restart (R3).

---

## 10. Критерий готовности

**Минимум (R0+R1):** при `wantConnected` softphone сам поднимает WSS после обрыва; не показывает вечный Registered при мёртвом signaling; звонок не зависает. **Сделано** в `web/src/softphoneClient.js` (2026-07-22).

**Сервер (C):** уже закрыт LineManager’ом.

---

## 11. Следующий шаг

При необходимости — **R3** (ICE restart). Иначе smoke по §7.
