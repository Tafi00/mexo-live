import { env } from './env.js';
import { closeDb, dbKind, initDb } from './db/client.js';
import { buildApp } from './app.js';
import { startJobs, stopJobs } from './jobs.js';
import { ensureBootstrapAdmin } from './cli/bootstrap.js';
import { loadRuntimeConfig, rc } from './services/runtimeConfig.js';

async function main() {
  await initDb();
  await loadRuntimeConfig();
  await ensureBootstrapAdmin();
  const app = await buildApp();
  await app.listen({ port: env.port, host: env.host });
  console.log(`\n  MEXO Live API  →  http://localhost:${env.port}`);
  console.log(`  Database       →  ${dbKind === 'pglite' ? `PGlite (nhúng) tại ${env.dataDir}` : 'PostgreSQL'}`);
  console.log(`  Shopee         →  ${rc().shopeeMode === 'mock' ? 'GIẢ LẬP (đổi tại Cấu hình hệ thống)' : rc().shopeeMode}\n`);
  await startJobs();

  const shutdown = async (sig: string) => {
    console.log(`\n[${sig}] đang dừng an toàn...`);
    await stopJobs();
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});
