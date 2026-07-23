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
