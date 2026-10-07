import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import type { User } from '../../src/generated/prisma/client.js';
import { prisma } from '../../src/lib/prisma.js';

export interface CreateUserInput {
  name?: string;
  email?: string;
  emailVerified?: boolean;
  image?: string | null;
  /** Se informada, cria a conta `credential` com o hash argon2id da senha. */
  password?: string;
}

/** Cria um usuário (verificado por padrão) com e-mail único. */
export async function createUser(input: CreateUserInput = {}): Promise<User> {
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      name: input.name ?? `Usuário ${suffix}`,
      email: input.email ?? `user-${suffix}@maratonei.test`,
      emailVerified: input.emailVerified ?? true,
      image: input.image ?? null,
    },
  });
  if (input.password !== undefined) {
    await prisma.account.create({
      data: {
        userId: user.id,
        providerId: 'credential',
        accountId: user.id,
        password: await argon2.hash(input.password, { type: argon2.argon2id }),
      },
    });
  }
  return user;
}
