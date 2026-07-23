FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY src ./src
COPY media ./media

ENV PORT=3101
ENV ABSENT_ANNOUNCE_FILE=/app/media/absent.wav
EXPOSE 3101
CMD ["node", "src/index.js"]
