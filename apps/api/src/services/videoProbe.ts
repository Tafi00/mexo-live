import { spawn } from 'node:child_process';
import { absPath } from './storage.js';

export interface ProbeResult {
  ok: boolean;
  reason?: string;
  durationSec?: number | null;
  width?: number | null;
  height?: number | null;
  codec?: string | null;
  bitrate?: number | null;
}

function containerOk(head: Buffer): boolean {
  if (head.length < 12) return false;
  if (head.subarray(4, 8).toString('ascii') === 'ftyp') return true; // MP4/MOV/M4V
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return true; // MKV/WEBM
  if (head.subarray(0, 3).toString('ascii') === 'FLV') return true;
  if (head[0] === 0x47) return true; // MPEG-TS
  if (['moov', 'mdat', 'wide', 'free'].includes(head.subarray(4, 8).toString('ascii'))) return true; // MOV cũ
  return false;
}

let ffprobeAvailable: boolean | null = null;

function runFfprobe(file: string): Promise<any | null> {
  return new Promise((resolve) => {
    const bin = process.env.FFPROBE_PATH || 'ffprobe';
    let out = '';
    let p;
    try {
      p = spawn(bin, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
    } catch {
      ffprobeAvailable = false;
      return resolve(null);
    }
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => {
      ffprobeAvailable = false;
      resolve(null);
    });
    p.on('close', (code) => {
      if (code !== 0) return resolve({ error: true });
      ffprobeAvailable = true;
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve({ error: true });
      }
    });
  });
}

/** Kiểm tra định dạng và chất lượng video sau khi tải xong */
export async function probeVideo(storageKey: string, head: Buffer): Promise<ProbeResult> {
  if (!containerOk(head)) return { ok: false, reason: 'bad_format' };
  if (ffprobeAvailable === false) return { ok: true };
  const info = await runFfprobe(absPath(storageKey));
  if (info === null) return { ok: true }; // không có ffprobe: chấp nhận, thời lượng lấy từ trình duyệt
  if (info.error) return { ok: false, reason: 'corrupt' };
  const v = (info.streams ?? []).find((s: any) => s.codec_type === 'video');
  if (!v) return { ok: false, reason: 'no_video_stream' };
  const duration = Number(info.format?.duration ?? v.duration ?? 0) || null;
  if (duration !== null && duration < 1) return { ok: false, reason: 'too_short' };
  return {
    ok: true,
    durationSec: duration,
    width: v.width ?? null,
    height: v.height ?? null,
    codec: v.codec_name ?? null,
    bitrate: Number(info.format?.bit_rate ?? 0) || null,
  };
}
