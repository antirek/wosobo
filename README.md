# Janus SIP Softphone (admin + softphone split)

Админка заводит ники и SIP-привязку к PBX. Softphone — только звонки по нику, **без SIP-секретов** в браузере.

План: [`PLAN-admin-softphone-split.md`](./PLAN-admin-softphone-split.md).

## Порты

| Сервис | URL / порт | Наружу |
|--------|------------|--------|
| Softphone UI (Vite) | http://localhost:3100 | да |
| softphone-api | http://localhost:3101 | да |
| Admin UI (Vite) | http://localhost:3120 | обычно внутрь |
| admin-api | http://127.0.0.1:3121 | **только localhost** |
| Monitor | http://localhost:3110 | внутрь |
| Janus WS / media | `:8188`, RTP | signaling только для softphone-api |

## Быстрый старт

```bash
docker-compose up -d --build

# Softphone UI
cd web && npm install && npm run dev

# Admin UI (другой терминал)
cd admin-ui && npm install && npm run dev
```

1. Admin: http://localhost:3120 — Basic `admin` / `admin`
2. Seed уже есть: `alice`→1001, `bob`→1002 на `asterisk`
3. Softphone: http://localhost:3100 — войдите как `alice` (без SIP-формы)
4. Наберите `1000` (Playback) или `1004` (Echo)

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
- **softphone-api**: `POST /api/session`, WSS `/ws/softphone?token=…` (без SIP полей)
