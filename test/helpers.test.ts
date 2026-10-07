import argon2 from 'argon2';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { createSession, createUser } from './factories/index.js';
import { allowedOrigin, asUser, sessionCookie } from './helpers/as-user.js';
import { resetDb } from './helpers/reset-db.js';
import { startFakeTmdb, type FakeTmdbServer } from './fakes/tmdb-server.js';

describe('factories', () => {
  it('createUser cria um usuário verificado por padrão, com id UUIDv7', async () => {
    const user = await createUser();
    expect(user.emailVerified).toBe(true);
    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(await prisma.account.count({ where: { userId: user.id } })).toBe(0);
  });

  it('createUser aceita não verificado e senha (conta credential com argon2id)', async () => {
    const user = await createUser({ emailVerified: false, password: 'senha-123' });
    expect(user.emailVerified).toBe(false);
    const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } });
    expect(account).toMatchObject({ providerId: 'credential', accountId: user.id });
    expect(account.password).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(account.password ?? '', 'senha-123')).toBe(true);
  });

  it('createSession cria uma sessão válida no banco', async () => {
    const user = await createUser();
    const session = await createSession(user);
    expect(session.userId).toBe(user.id);
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('apagar o usuário apaga sessões e contas em cascata', async () => {
    const user = await createUser({ password: 'x' });
    await createSession(user);
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.session.count()).toBe(0);
    expect(await prisma.account.count()).toBe(0);
  });
});

describe('asUser()', () => {
  const echo = express();
  echo.all('/echo', (req, res) => {
    res.json({ cookie: req.headers.cookie, origin: req.headers.origin });
  });

  it('envia o cookie de sessão e um Origin permitido em todas as requisições', async () => {
    const client = await asUser(undefined, echo);

    const first = await client.get('/echo');
    const second = await client.post('/echo');

    for (const res of [first, second]) {
      expect(res.body).toEqual({ cookie: sessionCookie(client.session), origin: allowedOrigin() });
    }
    const stored = await prisma.session.findUniqueOrThrow({
      where: { token: client.session.token },
    });
    expect(stored.userId).toBe(client.user.id);
  });

  it('usa o usuário informado', async () => {
    const user = await createUser({ name: 'Ana' });
    const client = await asUser(user, echo);
    expect(client.user.id).toBe(user.id);
    expect(client.session.userId).toBe(user.id);
  });

  it('passa pelo origin-check da aplicação real', async () => {
    const client = await asUser();
    const res = await client.post('/api/v1/qualquer');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ROUTE_NOT_FOUND');
  });
});

describe('resetDb()', () => {
  it('trunca as tabelas e preserva _prisma_migrations', async () => {
    await createSession(await createUser());
    await resetDb();
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.session.count()).toBe(0);
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL
    `;
    expect(Number(rows[0]?.count)).toBeGreaterThan(0);
  });
});

describe('TMDB fake', () => {
  let tmdb: FakeTmdbServer;
  beforeAll(async () => {
    tmdb = await startFakeTmdb();
  });
  afterAll(async () => {
    await tmdb.close();
  });

  it('responde 404 no formato do TMDB para rota não registrada', async () => {
    const res = await fetch(`${tmdb.baseUrl}/movie/1`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, status_code: 34 });
  });

  it('responde com o handler registrado e guarda as requisições', async () => {
    tmdb.on('GET', '/search/multi', ({ query }) => ({
      body: { page: 1, results: [], total_results: 0, query: query.get('query') },
    }));
    const res = await fetch(`${tmdb.baseUrl}/search/multi?query=duna&language=pt-BR`, {
      headers: { Authorization: 'Bearer fake' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ query: 'duna' });
    expect(tmdb.requests.at(-1)).toMatchObject({ method: 'GET', path: '/search/multi' });
    expect(tmdb.requests.at(-1)?.query.get('language')).toBe('pt-BR');
  });
});
