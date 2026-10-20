import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { asUser } from '../../test/helpers/as-user.js';

const WINDOW = { windowMs: 60_000 };

describe('rate limit (429 RATE_LIMITED)', () => {
  it('limite global: excede e responde problem+json com Retry-After', async () => {
    const app = createApp({ rateLimit: { global: { limit: 3, ...WINDOW } } });

    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await request(app).get('/api/v1/me')).status);
    const blocked = await request(app).get('/api/v1/me');

    expect(statuses).toEqual([401, 401, 401]);
    expect(blocked.status).toBe(429);
    expect(blocked.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(blocked.headers['retry-after']).toBe('60');
    expect(blocked.body).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
  });

  it('o health check não entra na contagem global', async () => {
    const app = createApp({ rateLimit: { global: { limit: 1, ...WINDOW } } });
    for (let i = 0; i < 5; i++) {
      expect((await request(app).get('/api/v1/health')).status).toBe(200);
    }
  });

  it('limite de /titles/* é separado do restante da API', async () => {
    const app = createApp({ rateLimit: { titles: { limit: 2, ...WINDOW } } });
    const agent = await asUser(undefined, app);

    expect((await agent.get('/api/v1/titles/search?q=a')).status).not.toBe(429);
    expect((await agent.get('/api/v1/titles/search?q=b')).status).not.toBe(429);
    const blocked = await agent.get('/api/v1/titles/search?q=c');
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');

    for (let i = 0; i < 5; i++) expect((await agent.get('/api/v1/me')).status).toBe(200);
  });

  it('desligado por padrão em NODE_ENV=test', async () => {
    const app = createApp();
    for (let i = 0; i < 20; i++) {
      expect((await request(app).get('/api/v1/me')).status).toBe(401);
    }
  });
});
