FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY src ./src

ENV PORT=3101
EXPOSE 3101
CMD ["node", "src/index.js"]
