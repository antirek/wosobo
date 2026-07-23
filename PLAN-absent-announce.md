# План: анонс «абонент отсутствует» (server-side WebRTC)

Связан с [`PLAN-admin-softphone-split.md`](./PLAN-admin-softphone-split.md), [`PLAN-reconnect.md`](./PLAN-reconnect.md).

**Цель:** при входящем SIP, когда softphone (WSS) offline, опционально **принять вызов на стороне softphone-api**, проиграть фразу и повесить трубку — вместо текущего `decline 486`.

**Не цель:** писать свой Janus plugin; менять always-on REGISTER; ICE restart / room / AudioBridge.

---

## 1. Продуктовое поведение

| Softphone WSS | `absentAnnounce` у subscriber | Поведение |
|---------------|------------------------------|-----------|
| online | любая | как сейчас: `incoming` → UI accept/decline |
| offline | **false** / нет | как сейчас: `decline` **486** |
| offline | **true** | server-side WebRTC: `accept` → play «абонент отсутствует» → `hangup` |

Звонящий слышит фразу после **200 OK** (не early media 183), затем разрыв.

Если во время анонса softphone подключился — **не** отдаём ему этот звонок (см. §4.3). Новый входящий после `idle` — обычная логика.

---

## 2. Зафиксированные решения

| # | Тема | Решение |
|---|------|---------|
| 1 | Где медиа | **softphone-api**, server-side `RTCPeerConnection` ↔ Janus SIP plugin (тот же handle) |
| 2 | Janus plugin | Только существующий **SIP**; без room / AudioBridge |
| 3 | Опция | Только **per-subscriber** `absentAnnounce` в Mongo |
| 4 | Default | `absentAnnounce: false` → сегодняшний 486 |
| 5 | Файл фразы | Один wav на стенд; путь из env; в репо — сгенерированный sample |
| 6 | Модульность | `softphone-api/src/absent/`; `LineManager` только policy + callbacks |
| 7 | WebRTC stack | **`@roamhq/wrtc@0.10.0`** + base image **`node:22-bookworm-slim`** (нужен GLIBC≥2.34; alpine не подходит) |
| 8 | Кодек | PCM из wav → `RTCAudioSource`; SDP/opus как получится с Janus (уточнить в A0) |
| 9 | Concurrent | Один absent на линию; второй входящий → **486** |
| 10 | Admin UI | Чекбокс на subscriber; без upload файла |
| 11 | Нет jsep в `incomingcall` | **Не** анонсировать → **486** + log |
| 12 | Свежесть флага | На каждый incoming: `getSubscriber(nick)` из Mongo (не только кэш линии) |
| 13 | ICE servers (стенд) | MVP: **`iceServers: []`** (localhost/docker). STUN — только если A0 покажет необходимость |
| 14 | Monitor | MVP: `call.state: "absent"` в `listStatuses` / softphone-api internal; UI monitor — **желательно** в A3, не блокер |
| 15 | Remote BYE mid-play | `cancel(nick)` → stop PCM, close PC, `callPhase=idle` (без второго hangup обязательно) |

---

## 3. Модель данных и конфиг

### 3.1. Subscriber (расширение)

```js
{
  nick, displayName, enabled, sip: { ... },
  absentAnnounce: boolean   // default false; отсутствие поля = false
}
```

- Admin API: поле в Public / Write / PATCH (bool).
- Seed: alice/bob → `false` (для ручного теста A1 можно временно `true` у alice в seed или mongo).

### 3.2. Env (softphone-api)

| Переменная | Default | Смысл |
|------------|---------|--------|
| `ABSENT_ANNOUNCE_FILE` | `/app/media/absent.wav` | Путь к PCM wav |
| `ABSENT_ANNOUNCE_MAX_SEC` | `30` | Safety hangup, если трек не закончился |

Включение фичи **только** из Mongo:

```
freshSubscriber.absentAnnounce === true
&& softphoneWs отсутствует (readyState !== OPEN)
&& callPhase === "idle"
&& jsepOffer?.sdp присутствует
&& файл читается
```

Иначе → **486** (как сейчас), кроме случая softphone online (обычный incoming).

### 3.3. Admin UI

Чекбокс: «При offline softphone — проигрывать „абонент отсутствует“».

---

## 4. Архитектура (модули)

```
softphone-api/src/
  lineManager.js
  absent/
    policy.js      # shouldAnnounce({ subscriber, softphoneOnline, jsepOffer })
    player.js      # PC + play + hangup/cancel
    audioFile.js   # load wav → Int16 PCM (+ sampleRate, channels)
    index.js       # createAbsentAnnounceService(deps)
media/
  absent.wav       # sample в репо (см. §5)
```

### 4.1. Контракт фасада

```ts
createAbsentAnnounceService({
  filePath: string,
  maxDurationMs: number,
  log: (line: string) => void,
}): {
  /** Boolean(subscriber?.absentAnnounce) */
  isEnabledFor(subscriber): boolean

  /**
   * false → LineManager делает decline 486
   * true  → сервис сам ведёт accept/play/hangup; LineManager ставит phase=absent
   */
  tryHandleIncoming(ctx: {
    nick: string
    subscriber: Subscriber          // уже свежий из getSubscriber
    softphoneOnline: boolean
    jsepOffer: object               // обязателен; без sdp → caller не зовёт tryHandle
    sendAccept: (jsep: object) => void
    sendHangup: () => void
    sendTrickle: (candidate: object | null) => void  // → session.trickle(handleId, …)
    onFinished: (reason: string) => void             // Line: reset idle
  }): Promise<boolean>

  /** Остановить play (remote BYE, teardown линии, destroy) */
  cancel(nick: string, reason?: string): void

  isActive(nick: string): boolean
}
```

`player` **не** держит прямой `JanusSession`: только `sendAccept` / `sendHangup` / `sendTrickle`.

### 4.2. `LineManager._onIncoming` (псевдокод)

```
async _onIncoming(result, jsep) {
  if (callPhase !== "idle") { decline 486; return }

  const softphoneOnline = softphoneWs?.readyState === OPEN

  if (softphoneOnline) {
    // существующий UI-path (incoming + jsep)
    return
  }

  // offline softphone
  const sub = await getSubscriber(nick)   // свежий документ
  if (sub) this.subscriber = sub          // обновить кэш линии

  const canTry =
    Boolean(sub?.absentAnnounce) &&
    Boolean(jsep?.sdp)

  if (canTry) {
    callPhase = "absent"
    const taken = await absent.tryHandleIncoming({
      nick, subscriber: sub, softphoneOnline: false,
      jsepOffer: jsep,
      sendAccept, sendHangup, sendTrickle,
      onFinished: (reason) => { log; _resetCall() },
    })
    if (taken) return
    // не вышло (нет файла / ошибка старта) — ниже 486
    callPhase = "idle"
  }

  log("incoming without softphone — 486")
  decline 486
}
```

`tryHandleIncoming` возвращает `false`, если: policy false, файл не прочитан, уже active, исключение до accept. После успешного старта accept — возвращает `true` даже если позже play упадёт (тогда `onFinished` / hangup).

### 4.3. Фаза `absent` и гонки

| Событие | Поведение |
|---------|-----------|
| `callPhase === "absent"` | `listStatuses`: `call.state = "absent"` |
| Softphone `attachSoftphone` mid-absent | Разрешить WS (hello: line registered, **call.state=absent** или idle+detail); **не** слать `incoming`; dial/accept на этот dialeg игнор/error |
| `detachSoftphone` mid-absent | Анонс **не** трогать |
| Второй `incomingcall` | decline **486** |
| Janus plugin `hangup` / remote BYE | `absent.cancel(nick)`; `_resetCall()` |
| `teardown` / unregister линии | `absent.cancel(nick)` затем teardown |
| Ошибка player после accept | `sendHangup` best-effort + `onFinished("error")` |

### 4.4. Поток `player.js`

1. `isActive(nick)` → уже есть → return false.
2. Прочитать файл через `audioFile` → fail → return false.
3. `RTCPeerConnection({ iceServers: [] })` (пока A0 не скажет иначе).
4. Outbound audio via `RTCAudioSource` / track.
5. `setRemoteDescription(jsepOffer)` → `createAnswer` → `setLocalDescription`.
6. ICE: trickle через `sendTrickle`; короткий wait gather (как softphone ~2.5s) опционально.
7. `sendAccept(answerJsep)`.
8. Старт push PCM (после `connectionState=connected` **или** сразу после accept + небольшой delay — выбрать в A0 что стабильнее).
9. EOF или `maxDurationMs` → `sendHangup()`, close PC, `onFinished("completed"|"timeout")`.
10. `cancel`: stop timers/source, close PC, не слать hangup если remote уже повесил (флаг).

### 4.5. Janus events (LineManager)

| Event | Во время `absent` |
|-------|-------------------|
| `accepted` / `webrtcup` / `media` | log only (player сам играет) |
| `hangup` (plugin/remote) | `absent.cancel` + `_resetCall` |
| `updatingcall` | decline/ignore или cancel+486 — **MVP: cancel announce + hangup** (не поддерживаем re-INVITE на анонсе) |
| trickle от Janus | `sendTrickle` уже от player наружу; inbound trickle → нужен колбэк в player **или** Line вызывает `absent.addRemoteCandidate(nick, c)` |

**Уточнение inbound trickle:** в фасад добавить:

```ts
addRemoteCandidate(nick: string, candidate: object | null): void
```

LineManager при `janus === "trickle"` и `callPhase === "absent"` → `absent.addRemoteCandidate(...)`, не на softphone WS.

---

## 5. Медиафайл

- Путь в репо: `softphone-api/media/absent.wav`.
- MVP: **WAV PCM s16le**, mono, 16 kHz или 48 kHz (что удобнее для `RTCAudioSource`; зафиксировать в A0/`audioFile`).
- Содержание: короткая фраза или явный тестовый тон 1–2 с + тишина; в README — как заменить файл.
- Генерация sample: скрипт `softphone-api/scripts/gen-absent-wav.mjs` (или sox в docs) — **файл коммитится в git**, чтобы docker build не зависел от ручного шага.
- Нет файла / битый wav при incoming → **486** + `log error` (boot API не падает).

---

## 6. Docker / native

- A0 фиксирует: npm-пакет + base image (`node:22-bookworm-slim` предпочтителен vs alpine).
- `COPY media/absent.wav`; env `ABSENT_ANNOUNCE_FILE`; optional volume.
- Build deps для native addon при необходимости.

---

## 7. Admin-api / UI

| Изменение | Детали |
|-----------|--------|
| admin-api | `absentAnnounce` в `toPublic` / parse body (bool, default false) |
| seed | `absentAnnounce: false` |
| Admin UI | checkbox |
| softphone UI | без изменений |
| softphone-api `getSubscriber` | прокидывать `absentAnnounce: Boolean(doc.absentAnnounce)` |

Смена флага **без** re-REGISTER: на следующем incoming читаем Mongo заново (§2.12).

---

## 8. Этапы реализации

### A0 — Spike

- [x] `@roamhq/wrtc@0.10.0` в Docker `node:22-bookworm-slim`
- [x] Sample `media/absent.wav` (PCM 16 kHz mono)
- [x] `iceServers: []` на стенде; sampleRate 16 kHz

**Exit:** образ softphone-api стартует с wrtc; полный accept+play — A1.

### A1 — Модуль + policy

- [x] `absent/` + врезка `_onIncoming`
- [x] Inbound trickle + remote hangup + cancel
- [x] Sample wav в репо
- [x] Флаг `absentAnnounce` читается из Mongo

### A2 — Admin

- [x] admin-api + Admin UI checkbox + seed default false

### A3 — Полировка

- [x] Логи absent start/end
- [x] `callPhase: absent` в listStatuses
- [ ] Monitor UI (опционально)
- [x] README / план

---

## 9. Тест-план

| # | Условия | Ожидание |
|---|---------|----------|
| T1 | `absentAnnounce=false`, softphone offline | 486, без accept |
| T2 | `absentAnnounce=true`, offline, есть wav+jsep | фраза, hangup, REGISTER жив |
| T3 | softphone online, флаг true | обычный incoming UI |
| T4 | alice true / bob false | разное поведение |
| T5 | второй входящий во время absent | 486 |
| T6 | нет/битый wav | 486 + error log |
| T7 | softphone connect mid-announce | нет UI incoming на этот call; после idle — ок |
| T8 | caller кладёт трубку mid-play | idle, без зомби PC |
| T9 | `incomingcall` без jsep, флаг true | 486 + log |

---

## 10. Риски

1. Native WebRTC + Docker image — A0.
2. Codec/SDP mismatch — A0; при необходимости PCMU в PC.
3. ICE без STUN на не-localhost — вне стенда может понадобиться STUN/host candidates.
4. Много одновременных анонсов — один на линию.
5. Inbound trickle timing — следовать softphone-паттерну.

---

## 11. Вне скоупа

- Upload своей фразы / TTS / early media 183.
- Свой Janus C plugin / AudioBridge room.
- Unregister при offline softphone.
- Анонс при `enabled=false`.
- Global kill-switch env.

---

## 12. Критерий готовности

1. `absentAnnounce=false` → поведение как текущий 486.
2. `absentAnnounce=true` + offline → слышна фраза, idle, REGISTER на месте.
3. Код в `src/absent/`; краевые случаи §2.11–15 и §4.3 закрыты.
4. A0 задокументирован (пакет, image, STUN/sampleRate).

---

## 13. Следующий шаг

**A0** (spike). Затем A1 → A2 → A3.
