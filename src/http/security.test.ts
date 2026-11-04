import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { allowedOrigin, asUser } from '../../test/helpers/as-user.js';
import { testApp } from '../../test/helpers/app.js';

const WINDOW = { windowMs: 60_000 };

describe('limite de escritas em /auth (contra força bruta)', () => {
  it('conta por IP do Express e ignora X-Forwarded-For forjado', async () => {
    const app = createApp({ rateLimit: { auth: { limit: 3, ...WINDOW } } });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/v1/auth/sign-in/email')
        .set('Origin', allowedOrigin())
        .set('X-Forwarded-For', `10.9.${i}.1`)
        .send({ email: 'x@maratonei.test', password: 'errada-12345' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 3)).not.toContain(429);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });

  it('leitura de sessão (GET) não gasta o teto', async () => {
    const app = createApp({ rateLimit: { auth: { limit: 1, ...WINDOW } } });
    for (let i = 0; i < 4; i++) {
      const res = await request(app).get('/api/v1/auth/get-session');
      expect(res.status).not.toBe(429);
    }
  });
});

describe('cadastro: tamanho do nome', () => {
  const signUp = (name: string, email: string) =>
    request(testApp())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', allowedOrigin())
      .send({ name, email, password: 'senha-segura-123' });

  it('nome de 81 caracteres ou vazio → 400, sem criar usuário', async () => {
    for (const [name, email] of [
      ['a'.repeat(81), 'longo@maratonei.test'],
      ['   ', 'vazio@maratonei.test'],
    ] as const) {
      const res = await signUp(name, email);
      expect(res.status).toBe(400);
      expect(await prisma.user.count({ where: { email } })).toBe(0);
    }
  });

  it('nome de 80 caracteres é aceito', async () => {
    const res = await signUp('a'.repeat(80), 'ok80@maratonei.test');
    expect(res.status).toBe(200);
  });
});

describe('byte NUL (antes virava 500)', () => {
  it('corpo com \\u0000 → 400 VALIDATION_FAILED', async () => {
    const client = await asUser();
    const res = await client.post('/api/v1/lists').send({ name: 'a\u0000b' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('%00 na URL → 400 VALIDATION_FAILED', async () => {
    const client = await asUser();
    const res = await client.get('/api/v1/invites/a%00b');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
