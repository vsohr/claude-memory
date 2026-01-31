import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['node_modules', 'tests', 'dist', '**/*.d.ts'],
    },
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
