import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

/**
 * Aplica as migrations no banco de teste com `prisma migrate deploy` (o mesmo
 * comando do CI e da produção; nunca `db push`).
 */
export default function globalSetup(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL não definida para os testes.');

  // Os testes truncam tabelas: só rodam contra um banco cujo nome indica teste.
  const databaseName = new URL(databaseUrl).pathname.slice(1);
  if (!databaseName.includes('test')) {
    throw new Error(`Os testes só rodam num banco de teste (recebido: "${databaseName}").`);
  }

  const require = createRequire(import.meta.url);
  const prismaCli = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    stdio: 'pipe',
    // O CLI prefere DIRECT_DATABASE_URL; fixamos a do teste para nunca cair no .env de dev.
    env: {
      ...process.env,
      DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL || databaseUrl,
      PRISMA_HIDE_UPDATE_MESSAGE: '1',
    },
  });
}
