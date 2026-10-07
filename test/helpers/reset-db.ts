import { prisma } from '../../src/lib/prisma.js';

let tables: string[] | undefined;

/**
 * Único jeito de limpar o banco nos testes: TRUNCATE de todas as tabelas de
 * `public`, exceto `_prisma_migrations`.
 */
export async function resetDb(): Promise<void> {
  tables ??= (
    await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `
  ).map((row) => `"public"."${row.tablename.replaceAll('"', '""')}"`);

  if (tables.length === 0) return;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}
