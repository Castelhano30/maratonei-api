import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { config } from '../../config.js';
import { prisma } from '../../lib/prisma.js';
import { testApp } from '../../../test/helpers/app.js';
import { allowedOrigin, asUser, sessionCookie } from '../../../test/helpers/as-user.js';
import { captureLogs } from '../../../test/helpers/log-capture.js';
import { linkIn, outbox } from '../../../test/helpers/outbox.js';
import { createSession } from '../../../test/factories/session.js';
import { createUser } from '../../../test/factories/user.js';
import { createAuth, createAuthHandler } from './auth.js';

const PASSWORD = 'senha-segura-123';
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function client() {
  return request.agent(testApp()).set('Origin', allowedOrigin());
}

function signUp(email: string, password = PASSWORD, agent = client()) {
  return agent.post('/api/v1/auth/sign-up/email').send({ name: 'Maria Silva', email, password });
}

function signIn(email: string, password = PASSWORD, agent = client()) {
  return agent.post('/api/v1/auth/sign-in/email').send({ email, password });
}

/** Segue o link do e-mail (origem do web) até a API, como o rewrite do web faria. */
function followLink(link: string) {
  const url = new URL(link);
  return request(testApp()).get(`${url.pathname}${url.search}`);
}

async function registerVerified(email: string) {
  await signUp(email);
  const link = linkIn(outbox.at(-1)!);
  await followLink(link);
}

describe('fluxo completo', () => {
  it('cadastro → login bloqueado → verificação → login → /me 200 → logout → /me 401', async () => {
    const agent = client();
    const email = 'fluxo@maratonei.test';

    expect((await signUp(email, PASSWORD, agent)).status).toBe(200);
    expect((await signIn(email, PASSWORD, agent)).status).toBe(403);
    expect((await agent.get('/api/v1/me')).status).toBe(401);

    expect((await followLink(linkIn(outbox.at(-1)!))).status).toBe(302);
    expect((await signIn(email, PASSWORD, agent)).status).toBe(200);
    expect((await agent.get('/api/v1/me')).status).toBe(200);

    expect((await agent.post('/api/v1/auth/sign-out').send({})).status).toBe(200);
    expect((await agent.get('/api/v1/me')).status).toBe(401);
  });
});

describe('cadastro', () => {
  it('cria o usuário não verificado, envia o e-mail de verificação e não abre sessão', async () => {
    const res = await signUp('novo@maratonei.test');

    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'novo@maratonei.test' } });
    expect(user.emailVerified).toBe(false);
    expect(user.id).toMatch(UUID_V7);
    expect(await prisma.session.count()).toBe(0);

    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.to).toBe('novo@maratonei.test');
    const link = new URL(linkIn(outbox[0]!));
    expect(link.origin).toBe(config.WEB_ORIGIN);
    expect(link.pathname).toBe('/api/v1/auth/verify-email');
    expect(link.searchParams.get('token')).toBeTruthy();
  });

  it('e-mail já cadastrado: resposta indistinguível do cadastro novo', async () => {
    await createUser({ email: 'existente@maratonei.test', password: PASSWORD });

    const novo = await signUp('outro@maratonei.test');
    const repetido = await signUp('existente@maratonei.test');

    expect(repetido.status).toBe(novo.status);
    expect(repetido.headers['set-cookie']).toBeUndefined();
    expect(Object.keys(repetido.body as object).sort()).toEqual(
      Object.keys(novo.body as object).sort(),
    );
    expect(Object.keys((repetido.body as { user: object }).user).sort()).toEqual(
      Object.keys((novo.body as { user: object }).user).sort(),
    );
    expect(await prisma.user.count({ where: { email: 'existente@maratonei.test' } })).toBe(1);
  });

  it.each([
    ['7 caracteres', 'a'.repeat(7)],
    ['129 caracteres', 'a'.repeat(129)],
  ])('rejeita senha com %s e não persiste nada', async (_nome, senha) => {
    const res = await signUp('curta@maratonei.test', senha);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.account.count()).toBe(0);
    expect(outbox).toHaveLength(0);
  });

  it('aceita senha de 8 e de 128 caracteres', async () => {
    expect((await signUp('oito@maratonei.test', 'a'.repeat(8))).status).toBe(200);
    expect((await signUp('cento@maratonei.test', 'a'.repeat(128))).status).toBe(200);
  });

  it('grava a senha como hash argon2id e a conta tem id UUIDv7', async () => {
    await signUp('hash@maratonei.test');

    const account = await prisma.account.findFirstOrThrow({
      where: { user: { email: 'hash@maratonei.test' } },
    });
    expect(account.providerId).toBe('credential');
    expect(account.id).toMatch(UUID_V7);
    expect(account.password).toMatch(/^\$argon2id\$/);
    expect(account.password).not.toContain(PASSWORD);
  });

  it('a unique (provider_id, account_id) impede duas contas iguais', async () => {
    const user = await createUser({ password: PASSWORD });

    await expect(
      prisma.account.create({
        data: { userId: user.id, providerId: 'credential', accountId: user.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('login', () => {
  it('não verificado: 403, sem sessão, e reenvia o e-mail de verificação', async () => {
    await signUp('pendente@maratonei.test');
    expect(outbox).toHaveLength(1);

    const res = await signIn('pendente@maratonei.test');

    expect(res.status).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await prisma.session.count()).toBe(0);
    expect(outbox).toHaveLength(2);
    expect(outbox[1]?.to).toBe('pendente@maratonei.test');
  });

  it('verificado e senha correta: cookie de sessão e GET /me 200', async () => {
    await registerVerified('ok@maratonei.test');
    const agent = client();

    const res = await signIn('ok@maratonei.test', PASSWORD, agent);

    expect(res.status).toBe(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookie).toMatch(/better-auth\.session_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).not.toMatch(/Secure/i); // NODE_ENV=test; Secure só em produção

    const me = await agent.get('/api/v1/me');
    expect(me.status).toBe(200);
    expect(me.body).toEqual({
      id: expect.stringMatching(UUID_V7) as string,
      name: 'Maria Silva',
      email: 'ok@maratonei.test',
      image: null,
    });
  });

  it('a sessão dura 30 dias', async () => {
    await registerVerified('dura@maratonei.test');
    await signIn('dura@maratonei.test');

    const session = await prisma.session.findFirstOrThrow();
    const days = (session.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('senha errada: 401 genérico, igual ao de e-mail inexistente', async () => {
    await registerVerified('errada@maratonei.test');

    const errada = await signIn('errada@maratonei.test', 'senha-incorreta-1');
    const inexistente = await signIn('ninguem@maratonei.test');

    expect(errada.status).toBe(401);
    expect(inexistente.status).toBe(401);
    expect(errada.body).toEqual(inexistente.body);
    expect(errada.headers['set-cookie']).toBeUndefined();
  });
});

describe('verificação de e-mail', () => {
  it('token válido: verifica, redireciona ao web e não cria sessão', async () => {
    await signUp('verifica@maratonei.test');

    const res = await followLink(linkIn(outbox[0]!));

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location!);
    expect(location.origin).toBe(config.WEB_ORIGIN);
    expect(location.pathname + location.search).toBe('/verificar-email?verified=1');
    expect(res.headers['set-cookie']).toBeUndefined();
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'verifica@maratonei.test' },
    });
    expect(user.emailVerified).toBe(true);
    expect(await prisma.session.count()).toBe(0);
  });

  it('token inválido: redireciona ao web com erro e nada é verificado', async () => {
    await signUp('invalido@maratonei.test');
    const link = new URL(linkIn(outbox[0]!));
    link.searchParams.set('token', 'token-invalido');

    const res = await followLink(link.toString());

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location!);
    expect(location.origin).toBe(config.WEB_ORIGIN);
    expect(location.searchParams.get('error')).toBeTruthy();
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'invalido@maratonei.test' },
    });
    expect(user.emailVerified).toBe(false);
  });

  it('token vencido (24 h): redireciona ao web com erro', async () => {
    await signUp('vencido@maratonei.test');
    const link = linkIn(outbox[0]!);
    // O token é um JWT assinado: o tempo é simulado avançando só o `Date`.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 25 * 60 * 60 * 1000 });
    let res;
    try {
      res = await followLink(link);
    } finally {
      vi.useRealTimers();
    }

    expect(res.status).toBe(302);
    expect(new URL(res.headers.location!).searchParams.get('error')).toBeTruthy();
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'vencido@maratonei.test' },
    });
    expect(user.emailVerified).toBe(false);
  });
});

describe('GET /api/v1/me e logout', () => {
  it('logout invalida cookie e sessão; GET /me volta a 401', async () => {
    await registerVerified('sai@maratonei.test');
    const agent = client();
    await signIn('sai@maratonei.test', PASSWORD, agent);
    expect((await agent.get('/api/v1/me')).status).toBe(200);

    const out = await agent.post('/api/v1/auth/sign-out').send({});

    expect(out.status).toBe(200);
    expect(await prisma.session.count()).toBe(0);
    const me = await agent.get('/api/v1/me');
    expect(me.status).toBe(401);
    expect(me.body).toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
  });

  it('sem cookie: 401 UNAUTHENTICATED em application/problem+json', async () => {
    const res = await request(testApp()).get('/api/v1/me');

    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
  });

  it('sessão expirada: 401', async () => {
    const user = await createUser();
    const session = await createSession(user, { expiresAt: new Date(Date.now() - 1000) });
    const res = await request(testApp()).get('/api/v1/me').set('Cookie', sessionCookie(session));

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('cookie sem assinatura válida: 401', async () => {
    const user = await createUser();
    const session = await createSession(user);

    const res = await request(testApp())
      .get('/api/v1/me')
      .set('Cookie', `better-auth.session_token=${session.token}.assinatura-falsa`);

    expect(res.status).toBe(401);
  });

  it('asUser: sessão aberta pelo helper é aceita e /me nunca expõe hash, token ou chave', async () => {
    const user = await createUser({ password: PASSWORD, image: 'https://img.test/a.png' });
    const agent = await asUser(user);

    const res = await agent.get('/api/v1/me');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
      image: 'https://img.test/a.png',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|token|password/i);
  });
});

describe('origem e logs', () => {
  it('POST em /auth/* sem Origin permitido: 403 ORIGIN_REJECTED', async () => {
    const sem = await request(testApp())
      .post('/api/v1/auth/sign-in/email')
      .send({ email: 'a@b.test', password: PASSWORD });
    const outra = await request(testApp())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', 'https://evil.example')
      .send({ name: 'X', email: 'a@b.test', password: PASSWORD });

    for (const res of [sem, outra]) {
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'ORIGIN_REJECTED' });
    }
    expect(await prisma.user.count()).toBe(0);
  });

  it('senha, token de verificação e cookie não aparecem nos logs', async () => {
    const { logger, raw } = captureLogs();
    const app = createApp({ config, logger });
    const agent = request.agent(app).set('Origin', allowedOrigin());

    await signUp('log@maratonei.test', PASSWORD, agent);
    const link = new URL(linkIn(outbox[0]!));
    const token = link.searchParams.get('token')!;
    await request(app).get(`${link.pathname}${link.search}`);
    await signIn('log@maratonei.test', PASSWORD, agent);
    await agent.get('/api/v1/me');

    const logs = raw.join('');
    expect(logs).toContain('verify-email');
    expect(logs).not.toContain(token);
    expect(logs).not.toContain(PASSWORD);
    expect(logs).not.toMatch(/better-auth\.session_token=[^;"\s]{10,}/);
  });
});

describe('callbackURL do link de verificação', () => {
  it('preserva o destino informado no cadastro, absoluto na origem do web', async () => {
    await client().post('/api/v1/auth/sign-up/email').send({
      name: 'Maria',
      email: 'cb@maratonei.test',
      password: PASSWORD,
      callbackURL: '/verificar-email?verified=1&next=%2Fconvite%2Fabc',
    });

    const link = new URL(linkIn(outbox[0]!));
    expect(link.searchParams.get('callbackURL')).toBe(
      `${config.WEB_ORIGIN}/verificar-email?verified=1&next=%2Fconvite%2Fabc`,
    );
    const res = await followLink(link.toString());
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      `${config.WEB_ORIGIN}/verificar-email?verified=1&next=%2Fconvite%2Fabc`,
    );
  });

  it('callbackURL absoluto de outra origem confiável (a da API) cai no destino padrão', async () => {
    await client().post('/api/v1/auth/sign-up/email').send({
      name: 'Maria',
      email: 'cb2@maratonei.test',
      password: PASSWORD,
      callbackURL: 'http://localhost:4000/api/v1/health',
    });

    const link = new URL(linkIn(outbox[0]!));
    expect(link.searchParams.get('callbackURL')).toBe(
      `${config.WEB_ORIGIN}/verificar-email?verified=1`,
    );
  });
});

describe('cookie em produção', () => {
  it('usa o prefixo __Secure- e o atributo Secure', async () => {
    await createUser({ email: 'prod@maratonei.test', password: PASSWORD });
    const production = createAuth({
      config: { ...config, NODE_ENV: 'production' },
      rateLimit: false,
    });
    const app = express();
    app.all('/api/v1/auth/*splat', createAuthHandler(production));

    const res = await request(app)
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', allowedOrigin())
      .send({ email: 'prod@maratonei.test', password: PASSWORD });

    expect(res.status).toBe(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookie).toMatch(/__Secure-better-auth.session_token=/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).not.toMatch(/Domain=/i);
  });
});

describe('rate limit do Better Auth', () => {
  it('limita tentativas repetidas de login com 429', async () => {
    const limited = createAuth({ rateLimit: true });
    const app = express();
    app.all('/api/v1/auth/*splat', createAuthHandler(limited));

    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await request(app)
        .post('/api/v1/auth/sign-in/email')
        .set('Origin', allowedOrigin())
        .set('X-Forwarded-For', '203.0.113.7')
        .send({ email: 'rl@maratonei.test', password: PASSWORD });
      statuses.push(res.status);
    }

    expect(statuses).toContain(429);
  });
});
