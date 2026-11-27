# syntax=docker/dockerfile:1
# MEXO Live 2 — API + giao diện web trong 1 image (máy phát MexoStreamer chạy riêng, xem apps/streamer/Dockerfile)
# Stage web, api, prod-deps độc lập → BuildKit chạy song song; mỗi stage chỉ copy phần mã nó cần nên sửa web
# không build lại API và ngược lại. Gói dependency production chỉ làm lại khi đổi lockfile/package.json.

# ── Cài dependency (cache theo lockfile) ──
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
# pnpm đúng phiên bản ghi ở packageManager trong package.json
RUN corepack enable && corepack install
COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/streamer/package.json apps/streamer/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

# ── node_modules production của API: chỉ phụ thuộc manifest + lockfile, không đụng mã nguồn ──
# (@mexo/shared được tsup gói thẳng vào dist nên không cần mã của nó ở đây)
FROM deps AS prod-deps
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm --filter @mexo/api deploy --prod --legacy /out \
 && test -f /out/package.json && test -d /out/node_modules/fastify

# ── Giao diện web ──
# Giống script build của apps/web, nhưng kiểm tra kiểu (tsc, incremental qua cache mount) chạy song song với
# vite build; bản nén brotli/gzip của file không đổi được lấy lại từ cache.
FROM deps AS web
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
WORKDIR /app/apps/web
RUN --mount=type=cache,target=/cache,sharing=locked \
    mkdir -p /cache/tsc /cache/compress; \
    pnpm exec tsc -p tsconfig.json --incremental --tsBuildInfoFile /cache/tsc/web.tsbuildinfo & tsc=$!; \
    pnpm exec vite build \
 && COMPRESS_CACHE=/cache/compress node scripts/compress.mjs \
 && wait $tsc \
 && test -f dist/index.html

# ── API ──
FROM deps AS api
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
WORKDIR /app/apps/api
RUN pnpm run build && test -f dist/index.js && test -f drizzle/meta/_journal.json

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
RUN mkdir -p /app/data /app/storage && chown node:node /app/data /app/storage
# Layer ít đổi trước (node_modules), mã build sau → mỗi lần deploy chỉ ghi lại vài MB
COPY --from=prod-deps --chown=node:node /out /app
COPY --from=api --chown=node:node /app/apps/api/drizzle /app/drizzle
COPY --from=api --chown=node:node /app/apps/api/dist /app/dist
COPY --from=web --chown=node:node /app/apps/web/dist /app/web
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
