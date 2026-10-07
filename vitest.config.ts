import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

// `.env.test` aponta para `maratonei_test`. Variáveis já definidas (ex.: no CI)
// têm precedência: o dotenv não sobrescreve o que já existe.
loadEnv({ path: '.env.test', quiet: true });

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup.ts'],
    // Um único banco real compartilhado: arquivos rodam em série.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
});
