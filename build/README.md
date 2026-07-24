# Build: Docker image `wosobo`

Собирает один runtime-образ со всеми app-процессами (supervisord):

| Процесс | Порт |
|---------|------|
| phone-server HTTP / WSS | 3101 / 3102 |
| monitor | 3110 |
| manage-api | 3121 |
| softphone-demo | 3130 |
| static-server (embed + manage UI) | 3140 |

Статика `softphone-embed` и `manage-web` собирается на этапе Docker build.

## Сборка

Из **корня репозитория**:

```bash
./build/build.sh
# только локально, без push:
PUSH=0 ./build/build.sh
# другой тег:
IMAGE=antirek/wosobo:0.0.3 ./build/build.sh
```

Или вручную:

```bash
docker build -f build/Dockerfile -t wosobo:latest .
```

Context — корень репо (`packages/…`). Деплой/конфиги сервера — в [`prod_deploy/`](../prod_deploy/), не здесь.
