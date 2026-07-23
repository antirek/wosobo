# План: npm workspaces + `packages/`

Связан с текущим стендом (admin/softphone split, Caddy, absent announce).

**Цель:** monorepo под **npm workspaces**, каталог `packages/`, единый root `package-lock.json`, имена `@wosobo/*`.

**Не цель:** UI-kit, TypeScript, shared-пакет «на будущее», смена runtime-контрактов (порты, Caddy paths, env).

**Статус решений:** зафиксированы (§7). Можно реализовывать.

---

## 1. Как сейчас

| Путь | `package.json` name | Роль | В compose? |
|------|---------------------|------|------------|
| `softphone-api/` | `janus-softphone-api` | WSS/API, Janus SIP, absent | да |
| `web/` | `janus-softphone-web` | Softphone UI (Vite) | через Caddy multi-stage |
| `admin-api/` | `janus-admin-api` | CRUD subscribers | да |
| `admin-ui/` | `janus-admin-ui` | Admin UI (Vite) | через Caddy multi-stage |
| `monitor/` | `janus-softphone-monitor` | Janus admin proxy + static | да |
| `api/` | `janus-softphone-api` | **legacy** pre-split | **нет → удалить** |

Инфра вне npm: `asterisk/`, `janus/`, `caddy/`, `docker-compose.yml`, `scripts/`, PLAN/README.

---

## 2. Целевая раскладка

```text
janus-sample/
  package.json              # workspaces root
  package-lock.json         # один lockfile
  .nvmrc                    # 22
  docker-compose.yml
  README.md
  PLAN-*.md
  scripts/                  # smoke и пр.
  asterisk/
  janus/
  caddy/                    # не npm-пакет
  packages/
    softphone-api/          # ← softphone-api/
    softphone-web/          # ← web/
    admin-api/              # ← admin-api/
    admin-web/              # ← admin-ui/
    monitor/                # ← monitor/
```

Legacy **`api/` удаляется** (не в workspaces, не архив).

### npm `name`

| Папка | name |
|-------|------|
| `packages/softphone-api` | `@wosobo/softphone-api` |
| `packages/softphone-web` | `@wosobo/softphone-web` |
| `packages/admin-api` | `@wosobo/admin-api` |
| `packages/admin-web` | `@wosobo/admin-web` |
| `packages/monitor` | `@wosobo/monitor` |

Все `"private": true`.

### Root `package.json`

```json
{
  "name": "janus-sample",
  "private": true,
  "engines": { "node": ">=22" },
  "workspaces": ["packages/*"],
  "scripts": {
    "dev:softphone-api": "npm run dev -w @wosobo/softphone-api",
    "dev:softphone-web": "npm run dev -w @wosobo/softphone-web",
    "dev:admin-api": "npm run dev -w @wosobo/admin-api",
    "dev:admin-web": "npm run dev -w @wosobo/admin-web",
    "dev:monitor": "npm run start -w @wosobo/monitor",
    "build:web": "npm run build -w @wosobo/softphone-web -w @wosobo/admin-web"
  }
}
```

Без `concurrently`: основной стенд — Docker; локально — точечный `-w`.

---

## 3. Вне `packages/`

| Артефакт | Решение |
|----------|---------|
| `asterisk/`, `janus/` | root |
| `caddy/` | root, **не** workspace |
| `docker-compose.yml` | root |
| PLAN/README | root; пути обновить |
| `scripts/` | root |
| `api/` | **удалить** |
| `packages/shared` | **не** вводим |

---

## 4. Docker — компактный вариант (зафиксировано)

**Стратегия B для runtime-сервисов:** context = `packages/<pkg>`, install как сейчас (без root workspaces в образе).

Почему компактнее A:

- в build context не попадает весь monorepo;
- в образе нет root `package.json` / чужих workspace `package.json`;
- слои = только deps этого сервиса + его `src` (+ `media` у softphone-api);
- workspaces остаются для **local/dev** и единого lockfile на машине разработчика.

### 4.1. Compose

```yaml
softphone-api:
  build: ./packages/softphone-api
admin-api:
  build: ./packages/admin-api
monitor:
  build: ./packages/monitor
caddy:
  build:
    context: .
    dockerfile: caddy/Dockerfile
```

### 4.2. Dockerfile сервиса (как сейчас, пути внутри package)

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY src ./src
# softphone-api: bookworm-slim + COPY media + wrtc
ENV PORT=3121
CMD ["node", "src/index.js"]
```

**Lockfile в образе:** у каждого пакета **нет** своего lock (один root). В Docker — `npm install` по `package.json` (как уже местами делают с `package-lock.json*`). Воспроизводимость версий — root lock для CI/dev; образы лёгкие. Не копируем root lock в package-context (иначе снова раздуваем context).

softphone-api: **`node:22-bookworm-slim`**, `media/`, `@roamhq/wrtc` — без изменений по смыслу.

### 4.3. Caddy (единственный root-context)

Context `.` неизбежен для двух UI в одном образе. Компактность через **узкий COPY + `.dockerignore`**:

```dockerfile
FROM node:22-alpine AS softphone-build
WORKDIR /app
COPY packages/softphone-web/package.json ./
RUN npm install
COPY packages/softphone-web/ ./
RUN npm run build

FROM node:22-alpine AS admin-build
WORKDIR /app
COPY packages/admin-web/package.json ./
RUN npm install
COPY packages/admin-web/ ./
RUN npm run build

FROM caddy:2.8-alpine
COPY --from=softphone-build /app/dist /srv/softphone
COPY --from=admin-build /app/dist /srv/admin
COPY caddy/Caddyfile /etc/caddy/Caddyfile
```

Vite `base: "/softphone/"`, `"/admin/"` — без изменений.

### 4.4. `.dockerignore` (root, для Caddy)

```
**/node_modules
**/dist
.git
packages/softphone-api
packages/admin-api
packages/monitor
asterisk
janus
*.md
```

(сервисные context’ы `packages/<pkg>` и так малы; при желании — локальный `.dockerignore` в пакете.)

---

## 5. Шаги миграции

1. Удалить `api/` (весь каталог).
2. Root: `package.json` (workspaces + scripts + engines), `.nvmrc` → `22`.
3. `git mv`:
   - `softphone-api` → `packages/softphone-api`
   - `web` → `packages/softphone-web`
   - `admin-api` → `packages/admin-api`
   - `admin-ui` → `packages/admin-web`
   - `monitor` → `packages/monitor`
4. В каждом пакете: `"name": "@wosobo/…"`, удалить вложенные `package-lock.json` и локальные `node_modules`.
5. С root: `npm install` → один `package-lock.json`.
6. Dockerfiles оставить **package-local** (context = package); поправить `docker-compose.yml`; обновить `caddy/Dockerfile` + root `.dockerignore`.
7. Grep/замена путей в README и PLAN (`admin-ui` → `packages/admin-web`, `softphone-api/media` → `packages/softphone-api/media`, …).
8. Smoke: `docker-compose up -d --build` → softphone / admin / monitor / absent.

---

## 6. Риски

| Риск | Митигация |
|------|-----------|
| Docker без per-package lock | приемлемо для стенда; при необходимости позже — `npm ci` из root в CI только для тестов |
| Битые пути в docs | grep по `admin-ui`, `^web/`, `api/` |
| Caddy context всё же root | `.dockerignore` режет API/infra |

---

## 7. Зафиксированные решения

| # | Тема | Решение |
|---|------|---------|
| 1 | Legacy `api/` | **Удалить** |
| 2 | Scope | **`@wosobo/*`** |
| 3 | Docker | **B — compact:** context = `packages/<pkg>` + локальный `npm install`; Caddy — root context, только два web-пакета |
| 4 | Dev-скрипты | Root `dev:*` / `build:web` через `-w`; **без** concurrently |
| 5 | monitor | Один пакет (express + `public/`) |
| 6 | shared | **Не** сейчас |
| 7 | Node | `"engines": { "node": ">=22" }` + **`.nvmrc` = 22** |
| 8 | caddy | Root, не workspace |
| 9 | Git | **`git mv`** |
| 10 | Root package name | **`janus-sample`** (`private`) |

---

## 8. Критерии готовности

- [x] `packages/{softphone-api,softphone-web,admin-api,admin-web,monitor}`; старые пути и **`api/`** удалены
- [x] Имена `@wosobo/*`; один root lockfile
- [x] `npm install` с root ок
- [x] `docker-compose up -d --build` ок; UI/API через Caddy
- [x] Absent: `packages/softphone-api/media/absent.wav` + env
- [x] README / ключевые PLAN с новыми путями

---

## 9. Вне скоупа

- pnpm / yarn, Turborepo / Nx
- React shared, CI matrix
- Перенос monitor static в Caddy
