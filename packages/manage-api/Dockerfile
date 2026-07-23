FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY src ./src
COPY openapi ./openapi

ENV PORT=3121
EXPOSE 3121
CMD ["node", "src/index.js"]
