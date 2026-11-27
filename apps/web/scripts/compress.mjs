// Nén sẵn file build (brotli + gzip) để API phục vụ trực tiếp, không nén lại mỗi request (@fastify/static preCompressed)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const EXT = new Set(['.js', '.css', '.html', '.svg', '.json', '.txt', '.webmanifest']);

let count = 0;
let before = 0;
let after = 0;
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else if (EXT.has(path.extname(name)) && st.size >= 1024) {
      const buf = fs.readFileSync(p);
      const br = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
      const gz = zlib.gzipSync(buf, { level: 9 });
      fs.writeFileSync(p + '.br', br);
      fs.writeFileSync(p + '.gz', gz);
      count++;
      before += buf.length;
      after += br.length;
    }
  }
}
walk(dist);
console.log(`Nén sẵn ${count} file: ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB (brotli)`);
