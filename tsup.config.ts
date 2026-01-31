import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'bin/cli.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  outDir: 'dist',
});
