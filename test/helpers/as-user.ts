import { createHmac } from 'node:crypto';
import type { Express } from 'express';
import supertest from 'supertest';
import { config } from '../../src/config.js';
import { SESSION_COOKIE_NAME } from '../../src/modules/auth/index.js';
import type { Session, User } from '../../src/generated/prisma/client.js';
import { createSession } from '../factories/session.js';
import { createUser } from '../factories/user.js';
import { testApp } from './app.js';

/**
 * Cookie de sessão enviado pelo `asUser()`. ÚNICO lugar com o nome e o formato
 * do cookie do Better Auth: valor `token.assinatura` (HMAC-SHA256 em base64 com o
 * `BETTER_AUTH_SECRET`), URL-encoded. Testes rodam com NODE_ENV=test, sem prefixo `__Secure-`.
 */
export function sessionCookie(session: Pick<Session, 'token'>): string {
  const signature = createHmac('sha256', config.BETTER_AUTH_SECRET)
    .update(session.token)
    .digest('base64');
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(`${session.token}.${signature}`)}`;
}

/** Origem permitida enviada em todas as requisições do cliente de teste. */
export function allowedOrigin(): string {
  const [origin] = config.ALLOWED_ORIGINS;
  if (!origin) throw new Error('ALLOWED_ORIGINS vazio no ambiente de teste.');
  return origin;
}

export type UserClient = supertest.Agent & { user: User; session: Session };

/**
 * Cliente Supertest autenticado: cria (ou usa) o usuário, abre uma sessão no
 * banco e envia o cookie de sessão e um `Origin` permitido em todas as requisições.
 */
export async function asUser(user?: User, app: Express = testApp()): Promise<UserClient> {
  const owner = user ?? (await createUser());
  const session = await createSession(owner);
  const agent = supertest
    .agent(app)
    .set('Origin', allowedOrigin())
    .set('Cookie', sessionCookie(session));
  return Object.assign(agent, { user: owner, session });
}
