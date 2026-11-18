# Dashboard image: stage 1 builds the React app, stage 2 runs only the Fastify server + built files.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY server ./server
COPY web ./web
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3100
COPY package.json package-lock.json ./
# React/Vite are dev dependencies (bundled at build time): not installed here.
RUN npm ci --omit=dev && npm cache clean --force
COPY tsconfig.json ./
COPY server ./server
COPY --from=build /app/web/dist ./web/dist

USER node
EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "--import", "tsx", "server/server.ts"]
