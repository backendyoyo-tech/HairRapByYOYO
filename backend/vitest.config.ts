import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true,
    setupFiles: [],
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
    deps: {
      inline: ['vitest'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});