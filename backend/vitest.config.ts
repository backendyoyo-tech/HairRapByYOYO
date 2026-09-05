import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    deps: {
      inline: ['vitest'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Full path aliases for shared modules
      '../shared/errors/index.js': path.resolve(__dirname, './vitest.mocks/shared-errors-mock.ts'),
      '../shared/errors': path.resolve(__dirname, './vitest.mocks/shared-errors-mock.ts'),
      '../shared/contracts/index.js': path.resolve(__dirname, './vitest.mocks/shared-contracts-mock.ts'),
      '../shared/contracts': path.resolve(__dirname, './vitest.mocks/shared-contracts-mock.ts'),
      // Prisma related mocks
      '@prisma/client/runtime/client': path.resolve(__dirname, './vitest.mocks/prisma-runtime-client-mock.ts'),
      '@prisma/client/runtime': path.resolve(__dirname, './vitest.mocks/prisma-runtime-client-mock.ts'),
    },
  },
  // Prevent Vitest from trying to transform generated Prisma files
  transformMode: {
    web: [/\.[jt]sx?$/],
    ssr: [/\.[jt]sx?$/],
  },
});