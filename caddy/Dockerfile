FROM node:22-alpine AS softphone-build
WORKDIR /app
COPY packages/softphone-web/package.json ./
RUN npm install
COPY packages/softphone-web/ ./
RUN npm run build

FROM node:22-alpine AS manage-build
WORKDIR /app
COPY packages/manage-web/package.json ./
RUN npm install
COPY packages/manage-web/ ./
RUN npm run build

FROM caddy:2.8-alpine
COPY --from=softphone-build /app/dist /srv/softphone
COPY --from=manage-build /app/dist /srv/manage
COPY caddy/Caddyfile /etc/caddy/Caddyfile
