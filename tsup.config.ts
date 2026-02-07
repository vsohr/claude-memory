import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'bin/cli.ts'],
  format: ['esm'],
  external: ['better-sqlite3'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  outDir: 'dist',
});
