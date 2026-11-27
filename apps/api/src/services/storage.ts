import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../env.js';

/**
 * Lưu trữ file cục bộ. Thiết kế theo "storage key" để có thể thay bằng Object Storage (S3/MinIO)
 * mà không đổi nghiệp vụ.
 */
export function absPath(key: string): string {
  const p = path.resolve(env.storageDir, key);
  if (!p.startsWith(path.resolve(env.storageDir))) throw new Error('Đường dẫn lưu trữ không hợp lệ');
  return p;
}

export async function ensureDir(key: string): Promise<void> {
  await fsp.mkdir(path.dirname(absPath(key)), { recursive: true });
}

export async function fileSize(key: string): Promise<number> {
  try {
    return (await fsp.stat(absPath(key))).size;
  } catch {
    return 0;
  }
}

export async function writeFile(key: string, data: Buffer): Promise<void> {
  await ensureDir(key);
  await fsp.writeFile(absPath(key), data);
}

export async function readFile(key: string): Promise<Buffer> {
  return fsp.readFile(absPath(key));
}

/** Ghi tiếp một đoạn vào cuối file (tải lên tiếp tục được) */
export async function appendChunk(key: string, data: Buffer): Promise<number> {
  await ensureDir(key);
  await fsp.appendFile(absPath(key), data);
  return fileSize(key);
}

export async function truncateTo(key: string, size: number): Promise<void> {
  try {
    await fsp.truncate(absPath(key), size);
  } catch {
    /* ignore */
  }
}

export async function removeFile(key: string | null | undefined): Promise<void> {
  if (!key) return;
  try {
    await fsp.unlink(absPath(key));
  } catch {
    /* ignore */
  }
}

export async function readHead(key: string, bytes = 64): Promise<Buffer> {
  const fh = await fsp.open(absPath(key), 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

export async function dirUsage(): Promise<{ usedBytes: number; freeBytes: number | null; totalBytes: number | null }> {
  let used = 0;
  async function walk(dir: string) {
    let entries: fs.Dirent[] = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else used += (await fsp.stat(p)).size;
    }
  }
  await walk(env.storageDir);
  let freeBytes: number | null = null;
  let totalBytes: number | null = null;
  try {
    await fsp.mkdir(env.storageDir, { recursive: true });
    const s = await fsp.statfs(env.storageDir);
    freeBytes = s.bavail * s.bsize;
    totalBytes = s.blocks * s.bsize;
  } catch {
    /* statfs không hỗ trợ */
  }
  return { usedBytes: used, freeBytes, totalBytes };
}

/** Trả file kèm hỗ trợ Range (xem trước video, máy phát tải tiếp) */
export async function sendFile(req: FastifyRequest, reply: FastifyReply, key: string, mime: string): Promise<FastifyReply> {
  const p = absPath(key);
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(p);
  } catch {
    return reply.code(404).send({ error: { code: 'file_missing', message: 'File không còn trên máy chủ' } });
  }
  const range = req.headers.range;
  reply.header('Accept-Ranges', 'bytes');
  reply.header('Content-Type', mime);
  reply.header('Cache-Control', 'private, max-age=3600');
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? Number(m[1]) : 0;
    let end = m && m[2] ? Number(m[2]) : stat.size - 1;
    if (!m?.[1] && m?.[2]) {
      start = Math.max(0, stat.size - Number(m[2]));
      end = stat.size - 1;
    }
    if (start >= stat.size || end >= stat.size || start > end) {
      reply.header('Content-Range', `bytes */${stat.size}`);
      return reply.code(416).send();
    }
    reply.code(206);
    reply.header('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    reply.header('Content-Length', end - start + 1);
    return reply.send(fs.createReadStream(p, { start, end }));
  }
  reply.header('Content-Length', stat.size);
  return reply.send(fs.createReadStream(p));
}
