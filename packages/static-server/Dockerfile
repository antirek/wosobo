# Serves embed + manage-web. Build from repo root:
#   docker build -f packages/static-server/Dockerfile -t wosobo-static .
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

FROM node:22-alpine
WORKDIR /app
COPY packages/static-server/package.json ./
RUN npm install --omit=dev
COPY packages/static-server/src ./src
COPY --from=embed-build /app/dist /srv/embed
COPY --from=manage-build /app/dist /srv/manage

ENV PORT=3140
ENV STATIC_ROOT=/srv
EXPOSE 3140
CMD ["node", "src/index.js"]
