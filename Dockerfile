# syntax=docker/dockerfile:1
# MEXO Live 2 — API + giao diện web trong 1 image (máy phát MexoStreamer chạy riêng, xem apps/streamer/Dockerfile)

# ── Cài dependency (cache theo lockfile) ──
FROM node:22-alpine AS deps
WORKDIR /app
RUN --mount=type=cache,target=/root/.npm npm install -g pnpm@10.26.0
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/streamer/package.json apps/streamer/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

# ── Build web + API, tách gói chạy production của API ──
FROM deps AS build
COPY . .
RUN pnpm --filter @mexo/web build && pnpm --filter @mexo/api build
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm --filter @mexo/api deploy --prod --legacy /out \
 && rm -rf /out/src /out/dist /out/drizzle /out/data /out/storage \
 && cp -r apps/api/dist apps/api/drizzle /out/ \
 && cp -r apps/web/dist /out/web \
 && test -f /out/dist/index.js && test -f /out/drizzle/meta/_journal.json && test -f /out/web/index.html

# ── Image chạy ──
FROM node:22-alpine
# ffprobe: kiểm tra codec/thời lượng video khi tải lên
RUN apk add --no-cache ffmpeg
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    SERVE_WEB=true \
    WEB_DIST=/app/web \
    DATA_DIR=/app/data \
    STORAGE_DIR=/app/storage
COPY --from=build --chown=node:node /out /app
RUN mkdir -p /app/data /app/storage && chown node:node /app/data /app/storage
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
