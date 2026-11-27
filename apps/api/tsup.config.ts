import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli/migrate-legacy.ts', 'src/cli/create-admin.ts', 'src/cli/seed-demo.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  sourcemap: true,
  // Gói chung mã nguồn TypeScript của workspace vào bundle
  noExternal: ['@mexo/shared'],
  external: ['@electric-sql/pglite'],
});
