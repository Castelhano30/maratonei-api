import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { asUser, sessionCookie } from '../../test/helpers/as-user.js';
import { createSession } from '../../test/factories/session.js';
import { createUser } from '../../test/factories/user.js';
import { fakeTmdb } from '../../test/helpers/tmdb.js';
import { movieDetail } from '../../test/fakes/tmdb-client.js';
import { PUBLIC_CACHE_CONTROL } from './public.js';

const WINDOW = { windowMs: 60_000 };
const SEARCH = '/api/v1/titles/search?q=duna';

describe('rotas públicas — cabeçalhos (AC-8.4)', () => {
  it('200 público leva Cache-Control público e nunca Set-Cookie', async () => {
    fakeTmdb.add(movieDetail());
    for (const path of [
      SEARCH,
      '/api/v1/titles/MOVIE/438631',
      '/api/v1/titles/MOVIE/438631/providers',
    ]) {
      const res = await request(createApp()).get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers['cache-control'], path).toBe(PUBLIC_CACHE_CONTROL);
      expect(res.headers['set-cookie'], path).toBeUndefined();
    }
    expect(PUBLIC_CACHE_CONTROL).toBe(
      'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400',
    );
  });

  it('4xx e 5xx levam no-store', async () => {
    const app = createApp();
    const invalid = await request(app).get('/api/v1/titles/search?q=');
    expect(invalid.status).toBe(400);
    expect(invalid.headers['cache-control']).toBe('no-store');

    const missing = await request(app).get('/api/v1/titles/MOVIE/999');
    expect(missing.status).toBe(404);
    expect(missing.headers['cache-control']).toBe('no-store');

    fakeTmdb.setDown(true);
    const down = await request(app).get('/api/v1/titles/MOVIE/998');
    expect(down.status).toBe(503);
    expect(down.headers['cache-control']).toBe('no-store');
  });

  it('429 leva no-store e Retry-After', async () => {
    const app = createApp({ rateLimit: { public: { limit: 1, ...WINDOW } } });
    await request(app).get(SEARCH).expect(200);
    const blocked = await request(app).get(SEARCH);
    expect(blocked.status).toBe(429);
    expect(blocked.headers['cache-control']).toBe('no-store');
    expect(blocked.headers['retry-after']).toBe('60');
  });

  it('rota com sessão não leva Cache-Control público', async () => {
    const agent = await asUser();
    const res = await agent.get('/api/v1/titles/recommendations').expect(200);
    expect(res.headers['cache-control'] ?? '').not.toContain('public');
    const me = await agent.get('/api/v1/me');
    expect(me.headers['cache-control'] ?? '').not.toContain('public');
  });
});

describe('rotas públicas — limites próprios (AC-8.5, AC-8.6)', () => {
  it('a requisição acima do limite por IP responde 429 RATE_LIMITED', async () => {
    const app = createApp({ rateLimit: { public: { limit: 3, ...WINDOW } } });
    for (let i = 0; i < 3; i++) await request(app).get(SEARCH).expect(200);
    const blocked = await request(app).get(SEARCH);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect(blocked.headers['content-type']).toMatch(/^application\/problem\+json/);
  });

  it('o teto global é um balde único para todos os IPs', async () => {
    const app = createApp({ rateLimit: { publicGlobal: { limit: 3, ...WINDOW } } });
    app.set('trust proxy', true);
    for (const ip of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) {
      await request(app).get(SEARCH).set('X-Forwarded-For', ip).expect(200);
    }
    const blocked = await request(app).get(SEARCH).set('X-Forwarded-For', '198.51.100.4');
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
  });

  it('o limite por IP separa clientes diferentes', async () => {
    const app = createApp({ rateLimit: { public: { limit: 1, ...WINDOW } } });
    app.set('trust proxy', true);
    await request(app).get(SEARCH).set('X-Forwarded-For', '198.51.100.1').expect(200);
    await request(app).get(SEARCH).set('X-Forwarded-For', '198.51.100.2').expect(200);
    await request(app).get(SEARCH).set('X-Forwarded-For', '198.51.100.1').expect(429);
  });

  it('rotas públicas não passam pelos limitadores atuais; seasons e recommendations passam', async () => {
    const app = createApp({
      rateLimit: { global: { limit: 2, ...WINDOW }, titles: { limit: 2, ...WINDOW } },
    });
    for (let i = 0; i < 100; i++) {
      expect((await request(app).get(SEARCH)).status).toBe(200);
    }

    const agent = await asUser(undefined, app);
    expect((await agent.get('/api/v1/titles/recommendations')).status).toBe(200);
    expect((await agent.get('/api/v1/titles/recommendations')).status).toBe(200);
    expect((await agent.get('/api/v1/titles/recommendations')).status).toBe(429);
  });
});

describe('rotas públicas — sem sessão e sem escrita (AC-8.7)', () => {
  it('a resposta é a mesma com cookie válido, inválido ou ausente, e nada é gravado', async () => {
    fakeTmdb.add(movieDetail());
    const user = await createUser();
    const session = await createSession(user);
    const app = createApp();
    const tables = async () => ({
      titles: await prisma.title.count(),
      users: await prisma.user.count(),
      sessions: await prisma.session.count(),
      lists: await prisma.list.count(),
    });
    const before = await tables();
    const sessionBefore = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });

    for (const path of [
      SEARCH,
      '/api/v1/titles/MOVIE/438631',
      '/api/v1/titles/MOVIE/438631/providers',
    ]) {
      const anonymous = await request(app).get(path);
      const valid = await request(app).get(path).set('Cookie', sessionCookie(session));
      const invalid = await request(app)
        .get(path)
        .set('Cookie', 'better-auth.session_token=lixo.lixo');
      expect(valid.status, path).toBe(anonymous.status);
      expect(invalid.status, path).toBe(anonymous.status);
      expect(valid.body, path).toEqual(anonymous.body);
      expect(invalid.body, path).toEqual(anonymous.body);
      expect(valid.headers['set-cookie'], path).toBeUndefined();
    }

    expect(await tables()).toEqual(before);
    const sessionAfter = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(sessionAfter.updatedAt).toEqual(sessionBefore.updatedAt);
  });
});
