import { PrismaPg } from '@prisma/adapter-pg';
import { config } from '../config.js';
import { PrismaClient } from '../generated/prisma/client.js';

export interface PoolTimeouts {
  /** Espera máxima por uma conexão do pool (ms). */
  connectionTimeoutMillis: number;
  /** Tempo máximo de cada query no servidor (ms); 0 desliga. */
  statementTimeoutMillis: number;
}

/** Cria um cliente Prisma sobre o driver `pg` (adapter-pg), com timeouts de pool opcionais. */
export function createPrismaClient(
  connectionString: string,
  timeouts?: PoolTimeouts,
): PrismaClient {
  const adapter = new PrismaPg({
    connectionString,
    ...(timeouts
      ? {
          connectionTimeoutMillis: timeouts.connectionTimeoutMillis,
          ...(timeouts.statementTimeoutMillis > 0
            ? { statement_timeout: timeouts.statementTimeoutMillis }
            : {}),
        }
      : {}),
  });
  return new PrismaClient({ adapter });
}

/** Cliente único da API (runtime usa sempre DATABASE_URL, com pooler em produção). */
export const prisma = createPrismaClient(config.DATABASE_URL, {
  connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT_MS,
  statementTimeoutMillis: config.DB_STATEMENT_TIMEOUT_MS,
});

export { Prisma } from '../generated/prisma/client.js';
