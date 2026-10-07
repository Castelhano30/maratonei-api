import { randomBytes } from 'node:crypto';
import type { Session, User } from '../../src/generated/prisma/client.js';
import { prisma } from '../../src/lib/prisma.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Cria uma sessão válida (7 dias) no banco para o usuário. */
export async function createSession(
  user: Pick<User, 'id'>,
  options: { expiresAt?: Date } = {},
): Promise<Session> {
  return prisma.session.create({
    data: {
      userId: user.id,
      token: randomBytes(32).toString('base64url'),
      expiresAt: options.expiresAt ?? new Date(Date.now() + 7 * DAY_MS),
      userAgent: 'vitest',
    },
  });
}
