import { PrismaPg } from '@prisma/adapter-pg';
import { config } from '../config.js';
import { PrismaClient } from '../generated/prisma/client.js';

/** Cria um cliente Prisma sobre o driver `pg` (adapter-pg). */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** Cliente único da API (runtime usa sempre DATABASE_URL, com pooler em produção). */
export const prisma = createPrismaClient(config.DATABASE_URL);

export { Prisma } from '../generated/prisma/client.js';
