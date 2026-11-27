# MexoStreamer — máy chủ đẩy luồng (cài trên từng máy phát, mở rộng theo chiều ngang)
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
RUN npm install --no-audit --no-fund tsup typescript @types/node && npx tsup src/index.ts --format esm --target node20 && rm -rf node_modules
ENV CACHE_DIR=/cache STREAMER_MODE=ffmpeg
VOLUME ["/cache"]
CMD ["node", "dist/index.js"]
