import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { config } from '../../config.js';
import { emailSender } from '../../lib/email.js';
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

describe('fluxo completo', () => {
  it('cadastro (já logado) → /me 200 → logout → /me 401 → login → /me 200', async () => {
    const agent = client();
    const email = 'fluxo@maratonei.test';

    expect((await signUp(email, PASSWORD, agent)).status).toBe(200);
    expect((await agent.get('/api/v1/me')).status).toBe(200);

    expect((await agent.post('/api/v1/auth/sign-out').send({})).status).toBe(200);
    expect((await agent.get('/api/v1/me')).status).toBe(401);

    expect((await signIn(email, PASSWORD, agent)).status).toBe(200);
    expect((await agent.get('/api/v1/me')).status).toBe(200);
  });
});

describe('cadastro', () => {
  it('cria o usuário com emailVerified=false, abre a sessão e não envia e-mail', async () => {
    const res = await signUp('novo@maratonei.test');

    expect(res.status).toBe(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookie).toMatch(/better-auth.session_token=/);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'novo@maratonei.test' } });
    expect(user.emailVerified).toBe(false);
    expect(user.id).toMatch(UUID_V7);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
    expect(outbox).toHaveLength(0);
  });

  it('e-mail já cadastrado: recusa sem criar outra conta nem abrir sessão', async () => {
    await createUser({ email: 'existente@maratonei.test', password: PASSWORD });

    const repetido = await signUp('existente@maratonei.test');

    expect(repetido.status).toBeGreaterThanOrEqual(400);
    expect(repetido.status).toBeLessThan(500);
    expect(repetido.headers['set-cookie']).toBeUndefined();
    expect(await prisma.user.count({ where: { email: 'existente@maratonei.test' } })).toBe(1);
    expect(await prisma.session.count()).toBe(0);
    expect(outbox).toHaveLength(0);
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
  it('conta não verificada e senha correta: 200 e sessão aberta', async () => {
    await createUser({
      email: 'pendente@maratonei.test',
      emailVerified: false,
      password: PASSWORD,
    });

    const res = await signIn('pendente@maratonei.test');

    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeDefined();
    expect(await prisma.session.count()).toBe(1);
    expect(outbox).toHaveLength(0);
  });

  it('verificado e senha correta: cookie de sessão e GET /me 200', async () => {
    await createUser({ email: 'ok@maratonei.test', name: 'Maria Silva', password: PASSWORD });
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
    await createUser({ email: 'dura@maratonei.test', password: PASSWORD });
    await signIn('dura@maratonei.test');

    const session = await prisma.session.findFirstOrThrow();
    const days = (session.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('senha errada: 401 genérico, igual ao de e-mail inexistente', async () => {
    await createUser({ email: 'errada@maratonei.test', password: PASSWORD });

    const errada = await signIn('errada@maratonei.test', 'senha-incorreta-1');
    const inexistente = await signIn('ninguem@maratonei.test');

    expect(errada.status).toBe(401);
    expect(inexistente.status).toBe(401);
    expect(errada.body).toEqual(inexistente.body);
    expect(errada.headers['set-cookie']).toBeUndefined();
  });
});

describe('GET /api/v1/me e logout', () => {
  it('logout invalida cookie e sessão; GET /me volta a 401', async () => {
    await createUser({ email: 'sai@maratonei.test', password: PASSWORD });
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

  it('senha e cookie não aparecem nos logs', async () => {
    const { logger, raw } = captureLogs();
    const app = createApp({ config, logger });
    const agent = request.agent(app).set('Origin', allowedOrigin());

    await signUp('log@maratonei.test', PASSWORD, agent);
    await signIn('log@maratonei.test', PASSWORD, agent);
    await agent.get('/api/v1/me');

    const logs = raw.join('');
    expect(logs).not.toContain(PASSWORD);
    expect(logs).not.toMatch(/better-auth\.session_token=[^;"\s]{10,}/);
  });
});

describe('reset de senha', () => {
  const NEW_PASSWORD = 'senha-nova-456';

  function requestReset(email: string, extra: Record<string, string> = {}, agent = client()) {
    return agent.post('/api/v1/auth/request-password-reset').send({ email, ...extra });
  }

  function resetWith(token: string, newPassword = NEW_PASSWORD, agent = client()) {
    return agent.post('/api/v1/auth/reset-password').send({ token, newPassword });
  }

  function tokenOf(link: URL) {
    return decodeURIComponent(link.pathname.split('/').at(-1)!);
  }

  /** Pede o reset de uma conta verificada e devolve o link e o token do e-mail. */
  async function requestedLink(email: string) {
    await requestReset(email);
    const link = new URL(linkIn(outbox.at(-1)!));
    return { link, token: tokenOf(link) };
  }

  it('conta existente: 200 neutro e e-mail com link na origem do web, token de 1 h', async () => {
    await createUser({ email: 'esqueci@maratonei.test', password: PASSWORD });

    const res = await requestReset('esqueci@maratonei.test');

    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.to).toBe('esqueci@maratonei.test');
    const link = new URL(linkIn(outbox[0]!));
    expect(link.origin).toBe(config.WEB_ORIGIN);
    expect(link.pathname).toMatch(/^\/api\/v1\/auth\/reset-password\/[^/]+$/);
    expect(link.searchParams.get('callbackURL')).toBe(`${config.WEB_ORIGIN}/redefinir-senha`);

    const verification = await prisma.verification.findFirstOrThrow({
      where: { identifier: { startsWith: 'reset-password:' } },
    });
    const minutes = (verification.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(59);
    expect(minutes).toBeLessThanOrEqual(60);
  });

  it('conta inexistente: mesma resposta 200 e nada é enviado', async () => {
    await createUser({ email: 'existe@maratonei.test', password: PASSWORD });

    const existente = await requestReset('existe@maratonei.test');
    outbox.length = 0;
    const inexistente = await requestReset('ninguem@maratonei.test');

    expect(inexistente.status).toBe(existente.status);
    expect(inexistente.body).toEqual(existente.body);
    expect(inexistente.headers['set-cookie']).toBeUndefined();
    expect(outbox).toHaveLength(0);
  });

  it('pedido repetido no throttle: mesma resposta 200 e sem segundo e-mail', async () => {
    await createUser({ email: 'repete@maratonei.test', password: PASSWORD });
    emailSender.configure({ throttleMs: 60_000 });

    const primeiro = await requestReset('repete@maratonei.test');
    const segundo = await requestReset('repete@maratonei.test');

    expect(segundo.status).toBe(200);
    expect(segundo.body).toEqual(primeiro.body);
    expect(outbox).toHaveLength(1);
  });

  it('link válido: 302 para /redefinir-senha?token= no web', async () => {
    await createUser({ email: 'valido@maratonei.test', password: PASSWORD });
    const { link, token } = await requestedLink('valido@maratonei.test');

    const res = await followLink(link.toString());

    expect(res.status).toBe(302);
    const location = new URL(res.headers.location!);
    expect(location.origin).toBe(config.WEB_ORIGIN);
    expect(location.pathname).toBe('/redefinir-senha');
    expect(location.searchParams.get('token')).toBe(token);
    expect(location.searchParams.get('error')).toBeNull();
  });

  it('callbackURL de outra origem cai no padrão /redefinir-senha', async () => {
    await createUser({ email: 'origem@maratonei.test', password: PASSWORD });

    await requestReset('origem@maratonei.test', {
      redirectTo: 'http://localhost:4000/api/v1/health',
    });

    const link = new URL(linkIn(outbox[0]!));
    expect(link.searchParams.get('callbackURL')).toBe(`${config.WEB_ORIGIN}/redefinir-senha`);
  });

  it('link inexistente ou vencido: 302 para /redefinir-senha?error=INVALID_TOKEN', async () => {
    await createUser({ email: 'vence@maratonei.test', password: PASSWORD });
    const { link } = await requestedLink('vence@maratonei.test');

    const inexistente = new URL(link.toString());
    inexistente.pathname = '/api/v1/auth/reset-password/token-que-nao-existe';
    const resInexistente = await followLink(inexistente.toString());
    expect(resInexistente.status).toBe(302);
    const erro = new URL(resInexistente.headers.location!);
    expect(erro.origin).toBe(config.WEB_ORIGIN);
    expect(erro.pathname).toBe('/redefinir-senha');
    expect(erro.searchParams.get('error')).toBe('INVALID_TOKEN');
    expect(erro.searchParams.get('token')).toBeNull();

    await prisma.verification.updateMany({
      where: { identifier: { startsWith: 'reset-password:' } },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const vencido = await followLink(link.toString());
    expect(vencido.status).toBe(302);
    expect(new URL(vencido.headers.location!).searchParams.get('error')).toBe('INVALID_TOKEN');
  });

  it('redefinição: troca a senha, revoga todas as sessões, não emite cookie e não abre sessão', async () => {
    await createUser({ email: 'troca@maratonei.test', password: PASSWORD });
    const antigo = client();
    const outro = client();
    await signIn('troca@maratonei.test', PASSWORD, antigo);
    await signIn('troca@maratonei.test', PASSWORD, outro);
    expect((await antigo.get('/api/v1/me')).status).toBe(200);
    expect(await prisma.session.count()).toBe(2);
    const { token } = await requestedLink('troca@maratonei.test');

    const res = await resetWith(token);

    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await prisma.session.count()).toBe(0);
    expect((await antigo.get('/api/v1/me')).status).toBe(401);
    expect((await outro.get('/api/v1/me')).status).toBe(401);
    expect((await signIn('troca@maratonei.test', PASSWORD)).status).toBe(401);
    const novo = client();
    expect((await signIn('troca@maratonei.test', NEW_PASSWORD, novo)).status).toBe(200);
    expect((await novo.get('/api/v1/me')).status).toBe(200);
    const account = await prisma.account.findFirstOrThrow({
      where: { user: { email: 'troca@maratonei.test' } },
    });
    expect(account.password).toMatch(/^\$argon2id\$/);
  });

  it('token reutilizado: 400 INVALID_TOKEN', async () => {
    await createUser({ email: 'usado@maratonei.test', password: PASSWORD });
    const { token } = await requestedLink('usado@maratonei.test');
    expect((await resetWith(token)).status).toBe(200);

    const again = await resetWith(token, 'outra-senha-789');

    expect(again.status).toBe(400);
    expect(again.body).toMatchObject({ code: 'INVALID_TOKEN' });
    expect((await signIn('usado@maratonei.test', NEW_PASSWORD)).status).toBe(200);
  });

  it.each([
    ['7 caracteres', 'a'.repeat(7)],
    ['129 caracteres', 'a'.repeat(129)],
  ])('senha com %s: 400 e o token segue válido', async (_nome, senha) => {
    await createUser({ email: 'politica@maratonei.test', password: PASSWORD });
    const { token } = await requestedLink('politica@maratonei.test');

    const res = await resetWith(token, senha);

    expect(res.status).toBe(400);
    expect((await signIn('politica@maratonei.test', PASSWORD)).status).toBe(200);
    expect((await resetWith(token)).status).toBe(200);
  });

  it('aceita senha de 8 e de 128 caracteres', async () => {
    await createUser({ email: 'limites@maratonei.test', password: PASSWORD });
    const oito = await requestedLink('limites@maratonei.test');
    expect((await resetWith(oito.token, 'a'.repeat(8))).status).toBe(200);
    const cento = await requestedLink('limites@maratonei.test');
    expect((await resetWith(cento.token, 'b'.repeat(128))).status).toBe(200);
  });

  it('token e senhas não aparecem nos logs', async () => {
    await createUser({ email: 'logs@maratonei.test', password: PASSWORD });
    const { logger, raw } = captureLogs();
    const app = createApp({ config, logger });
    const agent = request.agent(app).set('Origin', allowedOrigin());

    await agent.post('/api/v1/auth/request-password-reset').send({ email: 'logs@maratonei.test' });
    const link = new URL(linkIn(outbox[0]!));
    const token = tokenOf(link);
    await request(app).get(`${link.pathname}${link.search}`);
    await agent.post('/api/v1/auth/reset-password').send({ token, newPassword: NEW_PASSWORD });

    const logs = raw.join('');
    expect(logs).toContain('reset-password');
    expect(logs).not.toContain(token);
    expect(logs).not.toContain(PASSWORD);
    expect(logs).not.toContain(NEW_PASSWORD);
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
