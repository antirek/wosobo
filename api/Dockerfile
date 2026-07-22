FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY src ./src

ENV PORT=3001
EXPOSE 3001
CMD ["node", "src/index.js"]
