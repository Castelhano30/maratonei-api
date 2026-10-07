/**
 * Seed idempotente para dev e E2E: cria (ou atualiza) o usuário verificado usado
 * pelo E2E do web, com uma conta `credential` cuja senha é um hash argon2id.
 * Recusa rodar em produção.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client.js';

const SEED_E2E_EMAIL = 'e2e@maratonei.local';
const SEED_E2E_NAME = 'Usuário E2E';
const DEFAULT_SEED_E2E_PASSWORD = 'maratonei-e2e-123';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('O seed não roda com NODE_ENV=production.');
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL não definida.');
  }

  const password = process.env.SEED_E2E_PASSWORD || DEFAULT_SEED_E2E_PASSWORD;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { email: SEED_E2E_EMAIL },
        create: { email: SEED_E2E_EMAIL, name: SEED_E2E_NAME, emailVerified: true },
        update: { name: SEED_E2E_NAME, emailVerified: true },
      });

      const credential = await tx.account.findFirst({
        where: { userId: user.id, providerId: 'credential' },
      });
      if (credential) {
        await tx.account.update({
          where: { id: credential.id },
          data: { accountId: user.id, password: passwordHash },
        });
      } else {
        await tx.account.create({
          data: {
            userId: user.id,
            providerId: 'credential',
            accountId: user.id,
            password: passwordHash,
          },
        });
      }
    });

    console.log(`Seed concluído: usuário ${SEED_E2E_EMAIL} verificado.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
