// Nén sẵn file build (brotli + gzip) để API phục vụ trực tiếp, không nén lại mỗi request (@fastify/static preCompressed)
// Nén song song nhiều file. Đặt COMPRESS_CACHE=<thư mục> để giữ bản nén theo hash nội dung: file không đổi giữa
// các lần build (tên file Vite có hash) dùng lại bản cũ thay vì nén brotli lại (Dockerfile dùng cache mount cho thư mục này).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const EXT = new Set(['.js', '.css', '.html', '.svg', '.json', '.txt', '.webmanifest']);
const PARAMS = 'br11+gz9'; // đổi khi đổi thông số nén để bỏ bản cache cũ
const cacheDir = process.env.COMPRESS_CACHE ? path.resolve(process.env.COMPRESS_CACHE) : null;
const CACHE_KEEP_DAYS = 30;

function listFiles(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) listFiles(p, out);
    else if (EXT.has(path.extname(ent.name)) && fs.statSync(p).size >= 1024) out.push(p);
  }
  return out;
}

function readCache(key) {
  if (!cacheDir) return null;
  const br = path.join(cacheDir, `${key}.br`);
  const gz = path.join(cacheDir, `${key}.gz`);
  try {
    const hit = { br: fs.readFileSync(br), gz: fs.readFileSync(gz) };
    const now = new Date();
    fs.utimesSync(br, now, now);
    fs.utimesSync(gz, now, now);
    return hit;
  } catch {
    return null;
  }
}

function writeCache(key, ext, buf) {
  // Ghi file tạm rồi đổi tên: build bị ngắt giữa chừng không để lại bản nén hỏng trong cache
  const tmp = path.join(cacheDir, `${key}.${ext}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, path.join(cacheDir, `${key}.${ext}`));
}

async function compressFile(p) {
  const buf = fs.readFileSync(p);
  const key = crypto.createHash('sha256').update(PARAMS).update('\0').update(buf).digest('hex');
  let out = readCache(key);
  const cached = out !== null;
  if (!out) {
    const [br, gz] = await Promise.all([
      brotli(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }),
      gzip(buf, { level: 9 }),
    ]);
    out = { br, gz };
    if (cacheDir) {
      writeCache(key, 'br', br);
      writeCache(key, 'gz', gz);
    }
  }
  fs.writeFileSync(p + '.br', out.br);
  fs.writeFileSync(p + '.gz', out.gz);
  return { before: buf.length, after: out.br.length, cached };
}

function pruneCache() {
  const cutoff = Date.now() - CACHE_KEEP_DAYS * 86400_000;
  for (const name of fs.readdirSync(cacheDir)) {
    const p = path.join(cacheDir, name);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
    } catch {}
  }
}

if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true });
const results = await Promise.all(listFiles(dist).map(compressFile));
if (cacheDir) pruneCache();

const before = results.reduce((s, r) => s + r.before, 0);
const after = results.reduce((s, r) => s + r.after, 0);
const reused = results.filter((r) => r.cached).length;
console.log(
  `Nén sẵn ${results.length} file: ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB (brotli)` +
    (cacheDir ? ` · dùng lại ${reused} file từ cache` : ''),
);
