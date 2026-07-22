FROM node:22-alpine AS softphone-build
WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-alpine AS admin-build
WORKDIR /app
COPY admin-ui/package.json admin-ui/package-lock.json ./
RUN npm ci
COPY admin-ui/ ./
RUN npm run build

FROM caddy:2.8-alpine
COPY --from=softphone-build /app/dist /srv/softphone
COPY --from=admin-build /app/dist /srv/admin
COPY caddy/Caddyfile /etc/caddy/Caddyfile
