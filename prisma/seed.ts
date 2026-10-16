/**
 * Seed idempotente para dev e E2E: cria (ou atualiza) o usuário verificado usado
 * pelo E2E do web, com uma conta `credential` cuja senha é um hash argon2id.
 * Recusa rodar com NODE_ENV=production e contra banco que não seja local, a menos que
 * `SEED_ALLOW_REMOTE=1` (opt-in explícito).
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client.js';

const SEED_E2E_EMAIL = 'e2e@maratonei.local';
const SEED_E2E_NAME = 'Usuário E2E';
const SEED_LIST_NAME = 'Maratona de exemplo';
const SEED_LIST_DESCRIPTION = 'Lista de exemplo criada pelo seed de desenvolvimento.';
const DEFAULT_SEED_E2E_PASSWORD = 'maratonei-e2e-123';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function databaseHost(connectionString: string): string {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL inválida.');
  }
  // `?host=`/`?hostaddr=` trocam o host real da conexão: não há como confiar no hostname.
  if (url.searchParams.has('host') || url.searchParams.has('hostaddr')) {
    throw new Error('O seed recusa DATABASE_URL com "host" ou "hostaddr" na query.');
  }
  return url.hostname.toLowerCase();
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('O seed não roda com NODE_ENV=production.');
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL não definida.');
  }

  const host = databaseHost(connectionString);
  if (!LOCAL_HOSTS.has(host) && process.env.SEED_ALLOW_REMOTE !== '1') {
    throw new Error(
      `O seed recusa o banco "${host}" (não é local). Para forçar, defina SEED_ALLOW_REMOTE=1.`,
    );
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

      // Lista de exemplo do usuário E2E (idempotente: uma só, identificada por dono e nome).
      const existingList = await tx.list.findFirst({
        where: { ownerId: user.id, name: SEED_LIST_NAME },
        select: { id: true },
      });
      if (!existingList) {
        await tx.list.create({
          data: {
            name: SEED_LIST_NAME,
            description: SEED_LIST_DESCRIPTION,
            ownerId: user.id,
            members: { create: { userId: user.id, role: 'OWNER' } },
          },
        });
      }

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

    console.log(`Seed concluído: usuário ${SEED_E2E_EMAIL} verificado, com uma lista de exemplo.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
