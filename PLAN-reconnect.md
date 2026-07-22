# План: реконнект softphone (браузер ↔ Janus ↔ SIP)

Документ описывает, как восстанавливать работу веб-softphone после кратковременной потери сети.  
Связан с [`PLAN-janus-sip-softphone.md`](./PLAN-janus-sip-softphone.md). Текущий клиент явного реконнекта **не делает**.

---

## 1. Зачем

Сейчас при обрыве сети пользователь часто получает «мёртвую» линию: нет REGISTER, нет звука, кнопки в UI ещё показывают Registered. Нужно предсказуемое поведение:

- краткий glitch → по возможности продолжить без действий пользователя;
- длинный обрыв → понятный статус + авто-восстановление REGISTER;
- активный звонок → либо восстановить медиа, либо корректно завершить и показать причину.

---

## 2. Три независимых канала

```
Браузер
  ├─ (A) WebSocket / HTTP  →  Janus API          ← signaling session
  ├─ (B) WebRTC (ICE/DTLS) →  Janus media        ← аудио звонка
  └─ (косвенно)
       Janus SIP plugin    →  PBX REGISTER/INVITE ← «трубка» на АТС
```

| Канал | Что ломается при обрыве | Как чинить |
|-------|-------------------------|------------|
| **A. Janus session (WS)** | session timeout (~60 с без keepalive), handle detach | reconnect WS → reclaim session **или** новая session + attach + REGISTER |
| **B. WebRTC** | ICE disconnected/failed, one-way/no audio | ICE restart / новый PeerConnection; иначе hangup |
| **C. SIP на PBX** | re-REGISTER не уходит, Contact протухает | пока жив SIP-handle Janus — PBX часто ещё online; умер handle → снова `register` |

**Важно:** починить только WebRTC недостаточно, если умерла Janus session. Починить только WS недостаточно, если ICE уже failed в активном звонке.

---

## 3. Целевое поведение (продукт)

### 3.1. Не в звонке (только Registered)

| Обрыв | Ожидание |
|-------|----------|
| &lt; ~5–15 с | WS reconnect / session alive → статус остаётся Registered (или короткая «Переподключение…») |
| Дольше session timeout | Новая session → attach SIP → REGISTER → снова Registered |
| Offline долго | Статус Offline / Reconnecting с backoff; при появлении сети — авто REGISTER |

### 3.2. В активном звонке

| Обрыв | Ожидание |
|-------|----------|
| Очень короткий | Звук дёргается, звонок продолжается |
| Медиа lost, signaling жив | Попытка ICE restart (1–2 раза); успех → разговор; неудача → hangup + «Связь потеряна» |
| Signaling умер (session gone) | Звонок считать потерянным: local hangup/cleanup, UI idle, затем авто REGISTER заново (уже без звонка) |

Сохранять «тот же» SIP-диалог после полной смерти Janus session **в MVP реконнекта не требуется** (сложно и хрупко). Цель MVP: не оставлять зомби-UI и быстро вернуть линию в Registered.

### 3.3. Входящий (ringing UI)

- При обрыве во время incoming: остановить рингтон, decline/hangup best-effort, сброс в idle.
- После восстановления сети — обычный REGISTER (новый входящий сможет дозвониться).

---

## 4. Состояния UI (предложение)

Добавить явные статусы линии (поверх offline / registered / error):

| Статус | Смысл |
|--------|--------|
| `registered` | Норма |
| `reconnecting` | Идёт попытка восстановить WS/session/REGISTER |
| `offline` | Нет связи / исчерпаны попытки (или пользователь отключил) |
| `degraded` | REGISTER есть, но ICE/звонок в беде (опционально) |

Для звонка:

| callState | Смысл |
|-----------|--------|
| `in-call` | Нормальный разговор |
| `reconnecting-media` | Идёт ICE restart (опционально в UI) |
| → `idle` + причина | Звонок признан потерянным |

Лог событий оставить — критично для отладки реконнекта.

---

## 5. Технический дизайн

### 5.1. Обнаружение проблем

1. **Janus WS / transport**
   - колбэки ошибки/destroy session в `janus.js`;
   - `navigator.onLine` + события `online` / `offline` (эвристика, не единственный источник правды).
2. **WebRTC**
   - `pc.iceConnectionState` / `connectionState`: `disconnected` → таймер; `failed` → restart или hangup;
   - опционально: `onconnectionstatechange` на handle (если доступно через janus API).
3. **SIP**
   - события plugin: `registration_failed`, `unregistered`, отсутствие re-REGISTER;
   - после reclaim/новой session — всегда явный `register` и ждать `registered`.

### 5.2. Стратегия восстановления signaling (A)

```
onTransportLost:
  setStatus(reconnecting)
  if (callActive): markCallAtRisk / start media watchdog

  attempt 1..N (exponential backoff, jitter):
    try reclaim existing Janus session (если janus.js/server поддерживает и session ещё на сервере)
    else:
      create new session → attach sip → register(credentials)

  on registered:
    setStatus(registered)
    if call was active and media not recoverable → hangup call, keep registered

  on give up:
    setStatus(offline/error)
```

Хранить в памяти клиента (не localStorage пароля сверх текущего MVP): последние SIP credentials сессии, `display_name`, флаг «пользователь хотел быть online» (`wantRegistered`).

Реконнект **только если** `wantRegistered === true` (после ручного «Отключить REGISTER» — не реконнектить).

### 5.3. Стратегия медиа (B) — только при живом signaling

```
on iceConnectionState == disconnected:
  start timer T_disc (например 3–5 с)
  if recovered to connected/completed → cancel

on failed или T_disc истёк:
  try ICE restart once (createOffer iceRestart / Janus update path)
  if fail → hangup + notify user
```

Зависит от того, что поддерживает текущий `janus.js` + SIP plugin для re-INVITE/`update`. Если ICE restart через SIP plugin окажется неудобным в нашей версии — в MVP реконнекта допустимо упрощение: **при failed ICE сразу hangup**, а signaling всё равно авто-REGISTER.

### 5.4. Keepalive

- Не полагаться только на дефолт: убедиться, что Janus session keepalive (WS ping / periodic request) активен, пока вкладка open.
- Page Lifecycle: при `visibilitychange` / freeze — после возврата проверить session (дешёвый admin/info или plugin request); при мёртвой — reconnect flow.
- SIP keepalive уже частично на стороне Janus plugin (`keepalive_interval` в `janus.plugin.sip.jcfg`).

### 5.5. Гонки и идемпотентность

- Один «reconnect supervisor» (mutex/flag `reconnectInFlight`).
- Игнорировать late events от старого handle после начала нового attach.
- Не слать второй REGISTER параллельно с первого handle.
- При destroy по кнопке пользователя — `wantRegistered=false`, отменить pending timers.

---

## 6. Этапы реализации

### Этап R0 — Наблюдаемость (без авто-логики)

- [ ] Логировать: WS error/destroy, `iceConnectionState`, SIP register/unregistered, `online`/`offline`.
- [ ] В UI показывать «сырой» transport/ice state в логе (уже есть лог — расширить).
- [ ] Зафиксировать фактический `session-timeout` Janus в README.

**Exit:** по логам видно, что именно умерло при ручном offline браузера / DevTools «Offline».

### Этап R1 — Авто-REGISTER после потери session

- [ ] Флаг `wantRegistered`.
- [ ] На destroy/error Janus session → статус `reconnecting` → backoff → new session + attach + register.
- [ ] Не трогать сложный ICE restart.
- [ ] Если был звонок — принудительный local hangup/cleanup, затем reconnect линии.

**Exit:** Registered → DevTools Offline 70 с → Online → без кликов снова Registered; звонок при этом корректно сбрасывается.

### Этап R2 — Короткий обрыв WS без полной пересборки

- [ ] Использовать reclaim/session resume, если доступно в нашей связке `janus.js` 1.1.x + сервер.
- [ ] Если reclaim нет/не сработал — fallback на R1.

**Exit:** Offline 5–10 с (меньше session timeout) → восстановление быстрее, чем полный re-register (или документировать, что reclaim недоступен → всегда R1).

### Этап R3 — Медиа в звонке (опционально)

- [ ] Watchdog ICE `disconnected`/`failed`.
- [ ] Одна попытка ICE restart / SIP `update`; иначе hangup с понятным сообщением.
- [ ] Статус `reconnecting-media` в UI.

**Exit:** в Echo/1004 при кратковременном Offline звук либо возвращается, либо звонок чисто завершается; линия потом снова Registered (R1).

### Этап R4 — Полировка

- [ ] Jittered exponential backoff (например 1s, 2s, 5s, 10s, max 30s).
- [ ] Счётчик попыток + кнопка «Подключить снова».
- [ ] Не спамить REGISTER при флапе сети (min interval).
- [ ] Короткий smoke-checklist в README.

---

## 7. Тест-план

| # | Сценарий | Ожидание |
|---|----------|----------|
| T1 | Registered, Offline 3 с, Online | Остаёмся / быстро again Registered |
| T2 | Registered, Offline 90 с, Online | Авто re-REGISTER |
| T3 | In-call Echo, Offline 2 с | Звук может пропасть; после Online либо ок, либо hangup + Registered (по этапу R1/R3) |
| T4 | In-call, Offline 90 с | Звонок завершён в UI; после Online — Registered |
| T5 | Incoming ringing + Offline | Рингтон стоп, idle; после Online — Registered |
| T6 | Ручной «Отключить REGISTER» + Offline/Online | **Не** авто-коннект |
| T7 | Две вкладки один extension | Как и раньше: конфликт Contact; реконнект не обязан чинить |

Инструменты: Chrome DevTools → Network → Offline; переключение Wi‑Fi; монитор http://localhost:3110 (пропажа/появление SIP handle).

---

## 8. Риски и ограничения

1. **Смена IP/NAT** часто требует ICE restart; без TURN на не-localhost хуже.
2. **Janus session reclaim** зависит от версии API/`janus.js` — проверить до обещаний в UI.
3. **PBX** может быстрее нас снять Contact — тогда входящие не дойдут, пока не пройдёт re-REGISTER.
4. Реконнект ≠ always-on режим B (трубка без вкладки) — это по-прежнему вне скоупа.
5. Нельзя бесконечно ретраить в фоне без backoff — риск флаппинга на АТС.

---

## 9. Вне скоупа этого плана

- Always-on REGISTER на сервере без браузера.
- Восстановление того же SIP Call-ID после полной смерти Janus session.
- Seamless handover при смене устройства.
- Мобильные background restrictions (iOS/Android).

---

## 10. Критерий готовности

**Минимум (R0+R1):** после обрыва сети softphone сам возвращается в Registered (если пользователь не отключал линию), не показывает ложный Registered, активный звонок не зависает «вечно».

> Частично реализовано в клиенте (2026-07-22): авто-reconnect при `Lost connection…`, `session_timeout=300`, keepalive 10s, reconnect при возврате на вкладку.

**Желательно (R3):** короткие обрывы в разговоре либо переживаются, либо звонок завершается с понятным текстом.

---

## 11. Следующий шаг

Начать с **R0** (логи + воспроизведение Offline в DevTools), затем **R1** в `web/src/janusSip.js` + статусы в `App.jsx`.
`)