# Broker API image. Base = official Playwright image: Chromium + its system libraries, amd64 and arm64.
# The tag MUST match the "playwright" version in package-lock.json (browser build and library go together).
FROM mcr.microsoft.com/playwright:v1.65.1-noble

WORKDIR /app
ENV NODE_ENV=production \
    HEADLESS=true \
    HOST=0.0.0.0 \
    PORT=3000

# Dependencies first (cached layer). playwright, tsx and fastify are runtime dependencies.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY tsconfig.json ./
COPY src ./src

# Non-root user shipped with the Playwright image.
USER pwuser
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# node directly (no npm wrapper), so SIGTERM reaches the server's shutdown handler.
CMD ["node", "--import", "tsx", "src/server.ts"]
