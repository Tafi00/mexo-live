import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { env } from './env.js';
import { loadActor } from './auth/auth.js';
import { refCode } from './lib/crypto.js';
import { AppError } from './lib/errors.js';
import { raiseAlert } from './services/alerts.js';
import { ShopeeError } from './services/shopee/client.js';
import { accountRoutes } from './routes/accounts.js';
import { authRoutes } from './routes/auth.js';
import { bulkRoutes } from './routes/bulk.js';
import { catalogRoutes } from './routes/catalog.js';
import { mockShopeeRoutes } from './routes/mockShopee.js';
import { replyRoutes } from './routes/replies.js';
import { reportRoutes } from './routes/reports.js';
import { scheduleRoutes } from './routes/schedules.js';
import { serverRoutes } from './routes/servers.js';
import { sessionRoutes } from './routes/sessions.js';
import { shopRoutes } from './routes/shops.js';
import { systemRoutes } from './routes/system.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    rateLimit?: boolean;
  }
}

const hits = new Map<string, { n: number; reset: number }>();

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

/** Nén JSON của API (vd. Phòng điều khiển ~140KB, gọi lại mỗi 5 giây) — brotli mức nhanh, không thì gzip */
async function compressJson(acceptEncoding: string, body: string): Promise<{ encoding: 'br' | 'gzip'; data: Buffer } | null> {
  if (/\bbr\b/.test(acceptEncoding)) return { encoding: 'br', data: await brotli(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: Buffer.byteLength(body) } }) };
  if (/\bgzip\b/.test(acceptEncoding)) return { encoding: 'gzip', data: await gzip(body, { level: 6 }) };
  return null;
}

/** Request cùng địa chỉ với chính trang web (vd. truy cập qua domain gắn sau, khác PUBLIC_URL) là hợp lệ */
function sameHost(origin: string, host: string): boolean {
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.isProd ? 'info' : 'warn' },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

  // Kiểm tra Origin cho request ghi dữ liệu bằng cookie (chống CSRF)
  const allowedOrigins = new Set([env.publicUrl, env.apiPublicUrl, 'http://localhost:5173', 'http://127.0.0.1:5173']);
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url;
    if (url.startsWith('/api/streamer/') || url.startsWith('/api/mock-shopee/')) return;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers.cookie) {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin) && !sameHost(origin, req.host)) {
        return reply.code(403).send({ error: { code: 'bad_origin', message: 'Yêu cầu từ địa chỉ không hợp lệ' } });
      }
    }
    // Giới hạn tần suất đơn giản cho các route nhạy cảm
    if (req.routeOptions.config?.rateLimit) {
      const key = `${req.ip}:${req.routeOptions.url}`;
      const now = Date.now();
      const h = hits.get(key);
      if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + 60000 });
      else if (++h.n > 20) return reply.code(429).send({ error: { code: 'too_many_requests', message: 'Thao tác quá nhanh, vui lòng thử lại sau 1 phút' } });
    }
  });
  app.addHook('onSend', async (req, reply, payload) => {
    if (typeof payload !== 'string' || payload.length < 2048 || reply.hasHeader('content-encoding')) return payload;
    if (!String(reply.getHeader('content-type') ?? '').includes('application/json')) return payload;
    const c = await compressJson(String(req.headers['accept-encoding'] ?? ''), payload);
    if (!c) return payload;
    reply.header('content-encoding', c.encoding);
    reply.header('vary', 'accept-encoding');
    reply.removeHeader('content-length');
    return c.data;
  });
  app.addHook('preHandler', async (req) => {
    if (req.url.startsWith('/api/') && !req.url.startsWith('/api/streamer/') && !req.url.startsWith('/api/mock-shopee/')) await loadActor(req);
  });

  app.setErrorHandler((error: unknown, req, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.status).send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    // Lỗi Shopee chưa được nghiệp vụ xử lý riêng → báo rõ cho người dùng, không tính là lỗi chương trình
    if (error instanceof ShopeeError) {
      const messages: Record<string, string> = {
        auth: 'Shop cần cấp quyền lại trên Shopee',
        permission: 'Shopee từ chối quyền truy cập của ứng dụng',
        rate_limit: 'Shopee đang giới hạn tần suất, vui lòng thử lại sau ít giây',
        server: 'Shopee đang gặp lỗi, vui lòng thử lại sau',
        timeout: 'Shopee không phản hồi',
        network: 'Không kết nối được tới Shopee',
        circuit_open: 'Tạm ngắt gọi Shopee do lỗi kéo dài, vui lòng thử lại sau ít giây',
        not_configured: 'Chưa cấu hình ứng dụng Shopee (Partner ID / Partner Key)',
      };
      return reply.code(error.kind === 'auth' || error.kind === 'permission' ? 409 : 502).send({
        error: { code: `shopee_${error.kind}`, message: messages[error.kind] ?? `Shopee báo lỗi: ${error.message}`, details: { api: error.api, shopeeCode: error.code, requestId: error.requestId, ref: error.ref } },
      });
    }
    const e = error as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode && e.statusCode < 500) {
      const message = e.code === 'FST_REQ_FILE_TOO_LARGE' || e.code === 'FST_ERR_CTP_BODY_TOO_LARGE' ? 'Dữ liệu gửi lên quá lớn' : (e.message ?? 'Yêu cầu không hợp lệ');
      return reply.code(e.statusCode).send({ error: { code: e.code ?? 'bad_request', message } });
    }
    const ref = refCode();
    req.log.error({ err: error, ref, url: req.url }, 'Lỗi chưa xử lý');
    console.error(`[${ref}]`, error);
    void raiseAlert({ key: 'internal_error', type: 'internal_error', severity: 'warning', message: `Lỗi chương trình (mã ${ref}) tại ${req.method} ${req.routeOptions.url ?? req.url}` });
    return reply.code(500).send({ error: { code: 'internal', message: `Lỗi hệ thống, mã tham chiếu ${ref}`, ref } });
  });

  // Healthcheck của Hub gọi liên tục → không ghi log mỗi lần
  app.get('/api/health', { logLevel: 'warn' }, async () => ({ ok: true, time: new Date().toISOString() }));

  await app.register(authRoutes);
  await app.register(shopRoutes);
  await app.register(catalogRoutes);
  await app.register(sessionRoutes);
  await app.register(bulkRoutes);
  await app.register(scheduleRoutes);
  await app.register(replyRoutes);
  await app.register(accountRoutes);
  await app.register(serverRoutes);
  await app.register(systemRoutes);
  await app.register(reportRoutes);
  await app.register(mockShopeeRoutes);

  // Phục vụ giao diện web đã build (production)
  if (env.serveWeb && fs.existsSync(path.join(env.webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: env.webDist,
      wildcard: false,
      // Dùng bản .br/.gz nén sẵn lúc build (apps/web/scripts/compress.mjs)
      preCompressed: true,
      cacheControl: false,
      setHeaders: (res, filePath) => {
        // File trong /assets có mã hash trong tên → cache vĩnh viễn; index.html luôn hỏi lại để nhận bản deploy mới
        const rel = path.relative(env.webDist, filePath).split(path.sep).join('/');
        res.setHeader('Cache-Control', rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: { code: 'not_found', message: 'Không tìm thấy' } });
      // File tĩnh không tồn tại (vd. chunk của bản deploy cũ) → 404 thật, không trả index.html giả làm JS
      const pathname = req.url.split('?')[0];
      if (pathname.startsWith('/assets/') || /\.[a-z0-9]{2,5}$/i.test(pathname)) return reply.code(404).type('text/plain').send('Not found');
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: 'not_found', message: 'Không tìm thấy' } }));
  }
  return app;
}
