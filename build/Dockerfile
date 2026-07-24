# Wosobo app image: phone-server + manage-api + monitor + softphone-demo + static
# From repository root:
#   ./build/build.sh
#   # or: docker build -f build/Dockerfile -t wosobo:latest .

# --- frontend builds ---
FROM node:22-alpine AS embed-build
WORKDIR /app
COPY packages/softphone-embed/package.json ./
RUN npm install
COPY packages/softphone-embed/ ./
RUN npm run build

FROM node:22-alpine AS manage-build
WORKDIR /app
COPY packages/manage-web/package.json ./
RUN npm install
COPY packages/manage-web/ ./
RUN npm run build

# --- runtime ---
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends supervisor ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# --- phone-server (needs glibc / bookworm for @roamhq/wrtc) ---
WORKDIR /opt/wosobo/phone-server
COPY packages/phone-server/package.json ./
RUN npm install --omit=dev
COPY packages/phone-server/src ./src
COPY packages/phone-server/media ./media

# --- manage-api ---
WORKDIR /opt/wosobo/manage-api
COPY packages/manage-api/package.json ./
RUN npm install --omit=dev
COPY packages/manage-api/src ./src
COPY packages/manage-api/openapi ./openapi

# --- monitor ---
WORKDIR /opt/wosobo/monitor
COPY packages/monitor/package.json ./
RUN npm install --omit=dev
COPY packages/monitor/src ./src
COPY packages/monitor/public ./public

# --- softphone-demo ---
WORKDIR /opt/wosobo/softphone-demo
COPY packages/softphone-demo/package.json ./
RUN npm install --omit=dev
COPY packages/softphone-demo/src ./src
COPY packages/softphone-demo/public ./public

# --- static (embed + manage-web) ---
COPY --from=embed-build /app/dist /opt/wosobo/static/embed
COPY --from=manage-build /app/dist /opt/wosobo/static/manage
WORKDIR /opt/wosobo/static-server
COPY packages/static-server/package.json ./
RUN npm install --omit=dev
COPY packages/static-server/src ./src

COPY build/supervisord.conf /etc/supervisor/supervisord.conf
COPY build/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV ABSENT_ANNOUNCE_FILE=/opt/wosobo/phone-server/media/absent.wav
ENV STATIC_ROOT=/opt/wosobo/static

EXPOSE 3101 3102 3110 3121 3130 3140

WORKDIR /opt/wosobo
ENTRYPOINT ["/entrypoint.sh"]
