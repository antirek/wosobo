FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY src ./src
COPY public ./public
ENV PORT=3110
EXPOSE 3110
CMD ["node", "src/index.js"]
