import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/db/**/*.test.ts'],
    setupFiles: ['tests/stubs/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
