import { describe, expect, it, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { config } from '../config.js';
import { createPrismaClient, prisma } from '../lib/prisma.js';
import { asUser } from '../../test/helpers/as-user.js';
import { toAppError } from './error-handler.js';

// Porta fechada: o connect falha na hora com ECONNREFUSED.
const DEAD_URL = 'postgresql://x:y@127.0.0.1:5999/z';

async function captureError(client: PrismaClient): Promise<unknown> {
  try {
    await client.user.findFirst();
  } catch (error) {
    return error;
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
  throw new Error('a query deveria falhar');
}

describe('banco indisponível (503 DB_UNAVAILABLE)', () => {
  it('erro real de conexão recusada do adapter-pg vira DB_UNAVAILABLE', async () => {
    const adapter = new PrismaPg({ connectionString: DEAD_URL, connectionTimeoutMillis: 1500 });
    const error = await captureError(new PrismaClient({ adapter }));

    expect(toAppError(error)).toMatchObject({ code: 'DB_UNAVAILABLE', status: 503 });
  });

  it('statement_timeout do pool cancela a query e vira DB_UNAVAILABLE', async () => {
    const client = createPrismaClient(config.DATABASE_URL, {
      connectionTimeoutMillis: 2000,
      statementTimeoutMillis: 200,
    });
    try {
      const error = await client.$queryRaw`SELECT pg_sleep(2)`.catch((e: unknown) => e);
      expect(toAppError(error)).toMatchObject({ code: 'DB_UNAVAILABLE', status: 503 });
    } finally {
      await client.$disconnect();
    }
  });

  it('numa rota de negócio responde problem+json 503 e não vaza o erro do driver', async () => {
    const adapter = new PrismaPg({ connectionString: DEAD_URL, connectionTimeoutMillis: 1500 });
    const error = await captureError(new PrismaClient({ adapter }));
    const agent = await asUser();
    const spy = vi.spyOn(prisma.list, 'findMany').mockRejectedValueOnce(error);

    const res = await agent.get('/api/v1/lists');

    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 503, code: 'DB_UNAVAILABLE' });
    expect(JSON.stringify(res.body)).not.toMatch(/5999|127\.0\.0\.1|Prisma/);
  });

  it('erros que não são de conexão continuam 500', () => {
    expect(toAppError(new Error('boom'))).toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
