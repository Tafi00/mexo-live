# MEXO Live 2 — API + giao diện web (1 image)
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/streamer/package.json apps/streamer/
RUN pnpm install --frozen-lockfile=false
COPY . .
RUN pnpm --filter @mexo/web build && pnpm --filter @mexo/api build

FROM node:22-bookworm-slim
WORKDIR /app/apps/api
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production SERVE_WEB=true WEB_DIST=/app/apps/web/dist DATA_DIR=/data STORAGE_DIR=/storage
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/drizzle ./drizzle
COPY --from=build /app/apps/api/package.json ./package.json
COPY --from=build /app/apps/web/dist /app/apps/web/dist
VOLUME ["/data", "/storage"]
EXPOSE 4000
CMD ["node", "dist/index.js"]
