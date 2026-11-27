import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema.js';
import { env } from '../env.js';

export type DB = PostgresJsDatabase<typeof schema>;

export let db: DB;
let rawExec: (q: SQL) => Promise<Record<string, unknown>[]>;
let closeFn: () => Promise<void> = async () => {};
export let dbKind: 'postgres' | 'pglite' = 'postgres';

function findMigrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(process.cwd(), 'drizzle'), path.resolve(here, '../drizzle'), path.resolve(here, '../../drizzle')];
  for (const c of candidates) if (fs.existsSync(path.join(c, 'meta', '_journal.json'))) return c;
  throw new Error('Không tìm thấy thư mục migration drizzle');
}

export async function initDb(opts: { migrate?: boolean } = {}): Promise<void> {
  const migrationsFolder = findMigrationsDir();
  if (env.databaseUrl) {
    const client = postgres(env.databaseUrl, { max: 20, onnotice: () => {} });
    db = drizzlePostgres(client, { schema });
    rawExec = async (q) => (await db.execute(q)) as unknown as Record<string, unknown>[];
    closeFn = async () => client.end();
    dbKind = 'postgres';
    if (opts.migrate !== false) await migratePostgres(db, { migrationsFolder });
  } else {
    // Chế độ phát triển: PostgreSQL nhúng (PGlite), dữ liệu lưu tại DATA_DIR/pg
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite');
    const { migrate: migratePglite } = await import('drizzle-orm/pglite/migrator');
    fs.mkdirSync(env.dataDir, { recursive: true });
    const client = new PGlite(path.join(env.dataDir, 'pg'));
    const pdb = drizzlePglite(client, { schema });
    db = pdb as unknown as DB;
    rawExec = async (q) => ((await pdb.execute(q)) as unknown as { rows: Record<string, unknown>[] }).rows;
    closeFn = async () => client.close();
    dbKind = 'pglite';
    if (opts.migrate !== false) await migratePglite(pdb, { migrationsFolder });
  }
}

/** Chạy SQL thô và trả về mảng dòng (chuẩn hóa giữa postgres-js và PGlite) */
export async function rows<T = Record<string, unknown>>(q: SQL): Promise<T[]> {
  return (await rawExec(q)) as T[];
}

export async function closeDb(): Promise<void> {
  await closeFn();
}

export { sql };
