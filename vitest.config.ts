import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src/', import.meta.url)) },
  },
  test: {
    environment: 'node',
    maxWorkers: 1,
    isolate: true,
    experimental: { diagnostics: { isolate: false } },
    include: [
      'tests/unit/**/*.test.{ts,mjs}',
      'tests/integration/**/*.test.{ts,mjs}',
    ],
  },
});
