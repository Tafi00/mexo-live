/**
 * MexoStreamer — máy chủ đẩy luồng video lên Shopee Live.
 *
 * Hoạt động độc lập với trình duyệt người dùng:
 *  - Heartbeat vài giây/lần về API trung tâm (khóa riêng MEXO_SERVER_KEY), báo CPU/RAM/đĩa/băng thông.
 *  - Nhận "việc phát" (playlist + địa chỉ RTMP) theo mô hình trạng thái mong muốn → khởi động lại an toàn,
 *    không phát trùng: tiếp tục từ video đang dở (resumeIndex).
 *  - FFmpeg concat → 1 luồng RTMP liên tục, chuyển video không ngắt kết nối; tự chạy lại khi lỗi.
 *  - STREAMER_MODE=simulate: mô phỏng (không cần FFmpeg/file), dùng để chạy thử toàn hệ thống.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Nạp biến môi trường từ file .env (nếu có) — không ghi đè biến đã đặt
try {
  for (const line of fs.readFileSync(path.resolve('.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '');
  }
} catch {
  /* không có .env */
}

const VERSION = '1.0.0';
const API = (process.env.MEXO_API_URL || 'http://localhost:4000').replace(/\/$/, '');
const KEY = process.env.MEXO_SERVER_KEY || '';
const MODE = (process.env.STREAMER_MODE || 'ffmpeg') as 'ffmpeg' | 'simulate';
const MAX_STREAMS = Number(process.env.MAX_STREAMS || 50);
const CACHE_DIR = path.resolve(process.env.CACHE_DIR || './cache');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const OUT_W = Number(process.env.OUTPUT_WIDTH || 720);
const OUT_H = Number(process.env.OUTPUT_HEIGHT || 1280);
const VIDEO_BITRATE = process.env.VIDEO_BITRATE || '2500k';
const STREAM_COPY = ['1', 'true', 'yes'].includes(String(process.env.STREAM_COPY ?? '').toLowerCase());
const HOST = process.env.STREAMER_HOST_NAME || os.hostname();

if (!KEY) {
  console.error('Thiếu MEXO_SERVER_KEY (khóa máy chủ cấp trong trang Máy chủ phát).');
  process.exit(1);
}

interface PlaylistItem {
  videoId: number;
  name: string;
  durationSec: number;
  sizeBytes: number;
  version: number;
  url: string;
}
interface Job {
  jobId: number;
  sessionId: number;
  title: string;
  pushUrl: string | null;
  loop: boolean;
  resumeIndex: number;
  command: { seq: number; type: 'skip'; index: number } | null;
  playlist: PlaylistItem[];
}
interface Report {
  jobId: number;
  state: 'preparing' | 'pushing' | 'error' | 'stopped';
  videoIndex: number | null;
  positionSec: number | null;
  loops: number;
  error: string | null;
  commandSeq: number | null;
}

const log = (jobId: number | null, msg: string) => console.log(`${new Date().toISOString()} ${jobId ? `[job ${jobId}] ` : ''}${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ───────────── Tải video vào bộ nhớ đệm (tải tiếp được) ─────────────

const downloads = new Map<string, Promise<string>>();

function cachePath(v: PlaylistItem): string {
  return path.join(CACHE_DIR, `${v.videoId}-${v.version}.mp4`);
}

async function ensureVideo(v: PlaylistItem): Promise<string> {
  const file = cachePath(v);
  try {
    const st = await fsp.stat(file);
    if (st.size === v.sizeBytes) return file;
  } catch {
    /* chưa có */
  }
  const key = file;
  const existing = downloads.get(key);
  if (existing) return existing;
  const p = (async () => {
    await fsp.mkdir(CACHE_DIR, { recursive: true });
    const part = file + '.part';
    for (let attempt = 1; attempt <= 5; attempt++) {
      let have = 0;
      try {
        have = (await fsp.stat(part)).size;
      } catch {
        /* mới */
      }
      try {
        const res = await fetch(v.url, { headers: { 'x-mexo-server-key': KEY, ...(have ? { range: `bytes=${have}-` } : {}) } });
        if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
        if (have && res.status !== 206) have = 0;
        const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
        const reader = res.body!.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
        }
        await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())));
        const size = (await fsp.stat(part)).size;
        if (v.sizeBytes && size !== v.sizeBytes) throw new Error(`Lệch dung lượng ${size}/${v.sizeBytes}`);
        await fsp.rename(part, file);
        return file;
      } catch (e) {
        log(null, `Tải video ${v.videoId} lỗi (lần ${attempt}): ${(e as Error).message}`);
        await sleep(2000 * attempt);
      }
    }
    throw new Error(`Không tải được video "${v.name}"`);
  })().finally(() => downloads.delete(key));
  downloads.set(key, p);
  return p;
}

// ───────────── Bộ chạy 1 luồng ─────────────

class Runner {
  state: Report['state'] = 'preparing';
  videoIndex: number;
  positionSec = 0;
  loops = 0;
  error: string | null = null;
  commandSeq: number | null;
  private proc: ChildProcess | null = null;
  private stopped = false;
  private failures = 0;
  private listStart = 0;
  private looping = false;
  private simTimer: NodeJS.Timeout | null = null;

  constructor(public job: Job) {
    this.videoIndex = Math.min(Math.max(0, job.resumeIndex), Math.max(0, job.playlist.length - 1));
    this.commandSeq = job.command?.seq ?? null;
  }

  report(): Report {
    return { jobId: this.job.jobId, state: this.state, videoIndex: this.videoIndex, positionSec: Math.round(this.positionSec * 10) / 10, loops: this.loops, error: this.error, commandSeq: this.commandSeq };
  }

  update(job: Job) {
    const prevPush = this.job.pushUrl;
    this.job = { ...job };
    if (job.command && job.command.seq !== this.commandSeq) {
      this.commandSeq = job.command.seq;
      log(job.jobId, `Lệnh chuyển sang video ${job.command.index + 1}`);
      this.restartAt(job.command.index);
    } else if (prevPush !== job.pushUrl && job.pushUrl) {
      log(job.jobId, 'Địa chỉ đẩy luồng thay đổi — khởi động lại');
      this.restartAt(this.videoIndex);
    }
  }

  async start(): Promise<void> {
    log(this.job.jobId, `Bắt đầu "${this.job.title}" — ${this.job.playlist.length} video, từ video ${this.videoIndex + 1}, ${this.job.loop ? 'lặp vòng' : '1 lượt'}`);
    if (MODE === 'simulate') return this.simulate();
    try {
      this.state = 'preparing';
      for (const v of this.job.playlist) await ensureVideo(v);
    } catch (e) {
      this.state = 'error';
      this.error = (e as Error).message;
      await sleep(10000);
      if (!this.stopped) return this.start();
      return;
    }
    this.launch(this.videoIndex, false);
  }

  private simulate() {
    this.state = 'preparing';
    let last = Date.now();
    setTimeout(() => {
      if (this.stopped) return;
      this.state = 'pushing';
      this.simTimer = setInterval(() => {
        const now = Date.now();
        this.positionSec += (now - last) / 1000;
        last = now;
        const cur = this.job.playlist[this.videoIndex];
        if (cur && this.positionSec >= (cur.durationSec || 30)) {
          this.positionSec = 0;
          this.videoIndex++;
          if (this.videoIndex >= this.job.playlist.length) {
            if (this.job.loop) {
              this.videoIndex = 0;
              this.loops++;
            } else {
              this.videoIndex = this.job.playlist.length - 1;
              this.state = 'stopped';
              if (this.simTimer) clearInterval(this.simTimer);
            }
          }
          log(this.job.jobId, `▶ video ${this.videoIndex + 1}/${this.job.playlist.length}: ${this.job.playlist[this.videoIndex]?.name}`);
        }
      }, 500);
      last = Date.now();
    }, 2500);
  }

  private restartAt(index: number) {
    this.videoIndex = Math.max(0, Math.min(index, this.job.playlist.length - 1));
    this.positionSec = 0;
    if (MODE === 'simulate') return;
    this.kill();
    if (!this.stopped) this.launch(this.videoIndex, false);
  }

  /** Chạy FFmpeg với danh sách concat bắt đầu từ startIndex; loopAll = phát lặp toàn bộ danh sách */
  private launch(startIndex: number, loopAll: boolean) {
    if (this.stopped || !this.job.pushUrl) {
      if (!this.job.pushUrl) {
        this.state = 'error';
        this.error = 'Chưa có địa chỉ đẩy luồng';
      }
      return;
    }
    const items = loopAll ? this.job.playlist : this.job.playlist.slice(startIndex);
    this.listStart = loopAll ? 0 : startIndex;
    this.looping = loopAll;
    const listFile = path.join(CACHE_DIR, `job-${this.job.jobId}.txt`);
    fs.writeFileSync(listFile, items.map((v) => `file '${cachePath(v).replace(/'/g, "'\\''")}'`).join('\n'));
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1',
      '-re', ...(loopAll ? ['-stream_loop', '-1'] : []), '-f', 'concat', '-safe', '0', '-i', listFile,
      ...(STREAM_COPY
        ? // Video đã chuẩn hóa sẵn (cùng codec/độ phân giải): không mã hóa lại → ~10 lần ít CPU hơn
          ['-c', 'copy']
        : [
            '-vf', `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease,pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p`,
            '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-b:v', VIDEO_BITRATE, '-maxrate', VIDEO_BITRATE, '-bufsize', '5000k', '-g', '60', '-keyint_min', '60',
            '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
          ]),
      '-f', 'flv', '-flvflags', 'no_duration_filesize', this.job.pushUrl,
    ];
    const proc = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    this.state = 'preparing';
    let stderr = '';
    const total = items.reduce((s, v) => s + (v.durationSec || 0), 0);
    proc.stdout!.on('data', (buf: Buffer) => {
      const m = /out_time_ms=(\d+)/.exec(buf.toString());
      if (!m) return;
      if (this.state !== 'pushing') {
        this.state = 'pushing';
        this.error = null;
        this.failures = 0;
      }
      let t = Number(m[1]) / 1e6;
      if (loopAll && total > 0) {
        this.loops = Math.floor(t / total) + (this.loops > 0 ? 0 : 0);
        t = t % total;
      }
      let acc = 0;
      for (let i = 0; i < items.length; i++) {
        const d = items[i]!.durationSec || 0;
        if (t < acc + d || i === items.length - 1) {
          const idx = this.listStart + i;
          if (idx !== this.videoIndex) log(this.job.jobId, `▶ video ${idx + 1}/${this.job.playlist.length}: ${this.job.playlist[idx]?.name}`);
          this.videoIndex = idx;
          this.positionSec = t - acc;
          break;
        }
        acc += d;
      }
    });
    proc.stderr!.on('data', (b: Buffer) => (stderr = (stderr + b.toString()).slice(-2000)));
    proc.on('error', (e) => {
      this.state = 'error';
      this.error = `Không chạy được FFmpeg: ${e.message}`;
    });
    proc.on('close', async (code) => {
      if (this.proc !== proc || this.stopped) return;
      this.proc = null;
      if (code === 0 && !this.looping) {
        // Hết lượt đầu (bắt đầu giữa danh sách) → phát lặp toàn bộ hoặc dừng
        if (this.job.loop) {
          this.loops++;
          this.videoIndex = 0;
          return this.launch(0, true);
        }
        this.state = 'stopped';
        return;
      }
      this.failures++;
      this.state = 'error';
      this.error = `FFmpeg thoát (mã ${code}): ${stderr.trim().split('\n').pop() ?? ''}`.slice(0, 400);
      const wait = Math.min(30000, 2000 * 2 ** Math.min(this.failures - 1, 4));
      log(this.job.jobId, `${this.error} — chạy lại sau ${wait / 1000}s từ video ${this.videoIndex + 1}`);
      await sleep(wait);
      if (!this.stopped) this.launch(this.videoIndex, false);
    });
  }

  private kill() {
    const p = this.proc;
    this.proc = null;
    if (p && !p.killed) {
      p.kill('SIGTERM');
      setTimeout(() => !p.killed && p.kill('SIGKILL'), 3000);
    }
  }

  stop() {
    this.stopped = true;
    this.state = 'stopped';
    if (this.simTimer) clearInterval(this.simTimer);
    this.kill();
    log(this.job.jobId, 'Đã dừng');
  }
}

// ───────────── Số liệu máy ─────────────

let lastCpu = os.cpus().map((c) => c.times);
function cpuPercent(): number {
  const now = os.cpus().map((c) => c.times);
  let idle = 0;
  let total = 0;
  now.forEach((t, i) => {
    const p = lastCpu[i] ?? t;
    const dt = t.user - p.user + (t.nice - p.nice) + (t.sys - p.sys) + (t.irq - p.irq) + (t.idle - p.idle);
    idle += t.idle - p.idle;
    total += dt;
  });
  lastCpu = now;
  return total ? Math.round((1 - idle / total) * 1000) / 10 : 0;
}

let lastNet: { bytes: number; at: number } | null = null;
function netOutMbps(): number | undefined {
  try {
    const txt = fs.readFileSync('/proc/net/dev', 'utf8');
    let bytes = 0;
    for (const line of txt.split('\n').slice(2)) {
      const [iface, rest] = line.split(':');
      if (!rest || iface!.trim() === 'lo') continue;
      bytes += Number(rest.trim().split(/\s+/)[8] ?? 0);
    }
    const now = Date.now();
    const prev = lastNet;
    lastNet = { bytes, at: now };
    if (!prev) return undefined;
    return Math.round((((bytes - prev.bytes) * 8) / ((now - prev.at) / 1000) / 1e6) * 10) / 10;
  } catch {
    return undefined;
  }
}

async function diskInfo() {
  try {
    await fsp.mkdir(CACHE_DIR, { recursive: true });
    const s = await fsp.statfs(CACHE_DIR);
    return { diskTotal: s.blocks * s.bsize, diskUsed: (s.blocks - s.bavail) * s.bsize };
  } catch {
    return {};
  }
}

// ───────────── Vòng heartbeat ─────────────

const runners = new Map<number, Runner>();

async function heartbeat(): Promise<number> {
  const body = {
    version: VERSION,
    maxStreams: MAX_STREAMS,
    host: HOST,
    metrics: { cpu: cpuPercent(), ram: os.totalmem() - os.freemem(), ramTotal: os.totalmem(), netOutMbps: netOutMbps(), load: os.loadavg()[0], ...(await diskInfo()) },
    streams: [...runners.values()].map((r) => r.report()),
  };
  const res = await fetch(`${API}/api/streamer/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mexo-server-key': KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (res.status === 401) {
    // Khóa bị thu hồi / hết hạn: dừng mọi luồng ngay để hệ thống chuyển việc sang máy khác mà không bị 2 máy cùng đẩy
    if (runners.size) log(null, `Khóa máy chủ không còn hiệu lực — dừng ${runners.size} luồng`);
    for (const r of runners.values()) r.stop();
    runners.clear();
    throw new Error(data?.error?.message ?? 'Khóa máy chủ không hợp lệ');
  }
  if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
  if (data.accepted === false) log(null, `Bị từ chối: ${data.reason}`);
  const wanted = new Map<number, Job>((data.jobs ?? []).map((j: Job) => [j.jobId, j]));
  for (const id of data.stop ?? []) {
    runners.get(id)?.stop();
    runners.delete(id);
  }
  for (const [id, r] of runners) {
    if (!wanted.has(id)) {
      r.stop();
      runners.delete(id);
    }
  }
  for (const [id, job] of wanted) {
    const r = runners.get(id);
    if (r) r.update(job);
    else if (runners.size < MAX_STREAMS) {
      const nr = new Runner(job);
      runners.set(id, nr);
      void nr.start();
    }
  }
  return Number(data.intervalSec ?? 3) * 1000;
}

async function main() {
  console.log(`MexoStreamer ${VERSION} — chế độ ${MODE === 'simulate' ? 'MÔ PHỎNG' : 'FFmpeg/RTMP'} — API ${API} — tối đa ${MAX_STREAMS} luồng`);
  let failures = 0;
  for (;;) {
    let wait = 3000;
    try {
      wait = await heartbeat();
      if (failures) log(null, 'Đã kết nối lại với API');
      failures = 0;
    } catch (e) {
      failures++;
      if (failures === 1 || failures % 10 === 0) log(null, `Không báo về được API (${(e as Error).message}) — các luồng đang phát vẫn tiếp tục`);
      wait = Math.min(15000, 2000 * failures);
    }
    await sleep(wait);
  }
}

const shutdown = () => {
  for (const r of runners.values()) r.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
void main();
