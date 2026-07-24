# Результат `./configure.sh` — готовый пакет для сервера

Скопируйте **весь** этот каталог на машину деплоя и поднимите стек:

```bash
docker-compose up -d
# обновление конфигов:
docker-compose up -d --force-recreate
```

Файл `.env` в этой же директории подхватывается Compose сам (подстановка `${…}` и `env_file` у `wosobo`).

```text
result/
  docker-compose.yml
  .env
  SUMMARY.txt
  caddy/Caddyfile
  janus/*.jcfg
```

Образ `wosobo` должен быть уже на хосте (`docker pull` / `docker load`).
