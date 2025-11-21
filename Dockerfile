FROM oven/bun:alpine AS builder
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:alpine
# 1. Install Chromium
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
# 2. Tell Playwright to use the system Chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY main.js .
CMD ["bun", "run", "main.js"]