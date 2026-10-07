import type { Express } from 'express';
import supertest from 'supertest';
import { config } from '../../src/config.js';
import type { Session, User } from '../../src/generated/prisma/client.js';
import { createSession } from '../factories/session.js';
import { createUser } from '../factories/user.js';
import { testApp } from './app.js';

/**
 * Cookie de sessão enviado pelo `asUser()`. ÚNICO lugar com o nome e o formato
 * do cookie: a Fase 1 alinha com o Better Auth (nome `__Secure-` em produção e
 * valor assinado `token.assinatura`).
 */
export function sessionCookie(session: Pick<Session, 'token'>): string {
  return `better-auth.session_token=${encodeURIComponent(session.token)}`;
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
