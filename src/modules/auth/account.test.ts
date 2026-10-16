import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { config } from '../../config.js';
import { prisma } from '../../lib/prisma.js';
import { testApp } from '../../../test/helpers/app.js';
import { allowedOrigin, asUser, sessionCookie } from '../../../test/helpers/as-user.js';
import { captureLogs } from '../../../test/helpers/log-capture.js';
import { createSession } from '../../../test/factories/session.js';
import { createUser } from '../../../test/factories/user.js';
import { createInvite, createList, createMembership } from '../../../test/factories/list.js';
import { createAuth, createAuthHandler, revokeUnprovenAccess } from './auth.js';

const PASSWORD = 'senha-segura-123';
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function client() {
  return request.agent(testApp()).set('Origin', allowedOrigin());
}

function signIn(email: string, password = PASSWORD) {
  return client().post('/api/v1/auth/sign-in/email').send({ email, password });
}

describe('login com Google', () => {
  const GOOGLE_CONFIG = {
    ...config,
    GOOGLE_CLIENT_ID: 'client-id-de-teste',
    GOOGLE_CLIENT_SECRET: 'client-secret-de-teste',
  };

  interface FakeProfile {
    sub?: string;
    email: string;
    name?: string;
    emailVerified?: boolean;
  }

  function appWith(auth: ReturnType<typeof createAuth>) {
    const app = express();
    app.all('/api/v1/auth/*splat', createAuthHandler(auth));
    return app;
  }

  /** Better Auth com o Google falso: o ID token vale por definição e o perfil vem do teste. */
  function googleSignIn(profile: FakeProfile) {
    const auth = createAuth({
      config: GOOGLE_CONFIG,
      rateLimit: false,
      googleOverrides: {
        verifyIdToken: () => Promise.resolve(true),
        getUserInfo: () =>
          Promise.resolve({
            user: {
              name: profile.name ?? 'Maria Google',
              email: profile.email,
              image: 'https://lh3.googleusercontent.com/a/foto',
              emailVerified: profile.emailVerified ?? true,
            },
            data: { sub: profile.sub ?? 'google-sub-1' },
          }),
      },
    });
    return request(appWith(auth))
      .post('/api/v1/auth/sign-in/social')
      .set('Origin', allowedOrigin())
      .send({ provider: 'google', idToken: { token: 'id-token-falso' } });
  }

  function authorize(callbackURL: string) {
    const auth = createAuth({ config: GOOGLE_CONFIG, rateLimit: false });
    return request(appWith(auth))
      .post('/api/v1/auth/sign-in/social')
      .set('Origin', allowedOrigin())
      .send({ provider: 'google', callbackURL, disableRedirect: true });
  }

  it('sem credenciais o provedor fica desligado', async () => {
    const res = await client()
      .post('/api/v1/auth/sign-in/social')
      .send({ provider: 'google', callbackURL: `${config.WEB_ORIGIN}/listas` });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body).not.toHaveProperty('url');
  });

  it('o login por ID token fica desligado fora dos testes', async () => {
    const auth = createAuth({ config: GOOGLE_CONFIG, rateLimit: false });
    const res = await request(appWith(auth))
      .post('/api/v1/auth/sign-in/social')
      .set('Origin', allowedOrigin())
      .send({ provider: 'google', idToken: { token: 'qualquer' } });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it('com credenciais, devolve a URL do Google com o callback na origem do web', async () => {
    const res = await authorize(`${config.WEB_ORIGIN}/convite/abc`);

    expect(res.status).toBe(200);
    const url = new URL((res.body as { url: string }).url);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe('client-id-de-teste');
    expect(url.searchParams.get('redirect_uri')).toBe(
      `${config.WEB_ORIGIN}/api/v1/auth/callback/google`,
    );
  });

  it.each(['//evil.example/x', 'https://evil.example/x'])(
    'callbackURL fora da origem do web (%s) é rejeitado',
    async (callbackURL) => {
      const res = await authorize(callbackURL);

      expect(res.status).toBe(403);
      expect(res.body).not.toHaveProperty('url');
    },
  );

  it('e-mail novo: cria o usuário verificado com a conta Google e abre a sessão', async () => {
    const res = await googleSignIn({ email: 'novo-google@maratonei.test' });

    expect(res.status).toBe(200);
    expect((res.headers['set-cookie'] as unknown as string[]).join(';')).toMatch(
      /better-auth\.session_token=/,
    );
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'novo-google@maratonei.test' },
      include: { accounts: true },
    });
    expect(user.emailVerified).toBe(true);
    expect(user.id).toMatch(UUID_V7);
    expect(user.accounts).toHaveLength(1);
    expect(user.accounts[0]).toMatchObject({
      providerId: 'google',
      accountId: 'google-sub-1',
      password: null,
    });
    expect(user.accounts[0]?.id).toMatch(UUID_V7);
  });

  it('conta local NÃO verificada + Google: apaga a senha e as sessões antigas e vincula', async () => {
    const local = await createUser({
      email: 'vinculo@maratonei.test',
      name: 'Nome Local',
      emailVerified: false,
      password: PASSWORD,
    });
    await createSession(local);
    await createSession(local);

    const res = await googleSignIn({ email: 'vinculo@maratonei.test' });

    expect(res.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: local.id },
      include: { accounts: true },
    });
    expect(user.emailVerified).toBe(true);
    expect(user.accounts.map((a) => a.providerId)).toEqual(['google']);
    // As duas sessões antigas sumiram; só resta a aberta agora pelo Google.
    expect(await prisma.session.count({ where: { userId: local.id } })).toBe(1);
    expect(await prisma.user.count()).toBe(1);
    // A senha antiga não vale mais.
    expect((await signIn('vinculo@maratonei.test')).status).toBe(401);
  });

  it('conta local verificada + Google: vincula preservando dados, senha e sessões', async () => {
    const local = await createUser({
      email: 'verificada@maratonei.test',
      name: 'Nome Local',
      password: PASSWORD,
    });
    await createSession(local);

    const res = await googleSignIn({
      email: 'verificada@maratonei.test',
      name: 'Nome do Google',
    });

    expect(res.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: local.id },
      include: { accounts: true },
    });
    expect(user.name).toBe('Nome Local');
    expect(user.image).toBeNull();
    expect(user.accounts.map((a) => a.providerId).sort()).toEqual(['credential', 'google']);
    expect(await prisma.session.count({ where: { userId: local.id } })).toBe(2);
    expect((await signIn('verificada@maratonei.test')).status).toBe(200);
  });

  it('e-mail do Google não verificado: não vincula a conta existente', async () => {
    const local = await createUser({ email: 'alvo@maratonei.test', password: PASSWORD });

    const res = await googleSignIn({ email: 'alvo@maratonei.test', emailVerified: false });

    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
    const accounts = await prisma.account.findMany({ where: { userId: local.id } });
    expect(accounts.map((a) => a.providerId)).toEqual(['credential']);
    expect(await prisma.session.count()).toBe(0);
  });

  it('e-mail do Google não verificado e conta local não verificada: nada muda', async () => {
    const local = await createUser({
      email: 'pendente-g@maratonei.test',
      emailVerified: false,
      password: PASSWORD,
    });

    const res = await googleSignIn({ email: 'pendente-g@maratonei.test', emailVerified: false });

    expect(res.status).toBeGreaterThanOrEqual(400);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: local.id },
      include: { accounts: true },
    });
    expect(user.emailVerified).toBe(false);
    expect(user.accounts.map((a) => a.providerId)).toEqual(['credential']);
  });

  it('e-mail do Google não verificado e sem conta: nenhuma sessão é aberta', async () => {
    const res = await googleSignIn({ email: 'sem-conta@maratonei.test', emailVerified: false });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await prisma.session.count()).toBe(0);
  });

  it('e-mail novo do Google não verificado: nenhum usuário nem conta é criado', async () => {
    await googleSignIn({ email: 'pre-hijack@maratonei.test', emailVerified: false });

    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.account.count()).toBe(0);
  });

  it('revokeUnprovenAccess apaga senha e sessões, mantendo o usuário e outras contas', async () => {
    const user = await createUser({ emailVerified: false, password: PASSWORD });
    await prisma.account.create({
      data: { userId: user.id, providerId: 'google', accountId: 'sub-x' },
    });
    await createSession(user);

    await revokeUnprovenAccess(user.id);

    const accounts = await prisma.account.findMany({ where: { userId: user.id } });
    expect(accounts.map((a) => a.providerId)).toEqual(['google']);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
  });

  it('o mesmo sub do Google nunca gera duas contas', async () => {
    await googleSignIn({ email: 'repete-g@maratonei.test' });
    const again = await googleSignIn({ email: 'repete-g@maratonei.test' });

    expect(again.status).toBe(200);
    expect(await prisma.account.count({ where: { providerId: 'google' } })).toBe(1);
    expect(await prisma.user.count()).toBe(1);
  });

  it('code e state do callback não aparecem nos logs', async () => {
    const { logger, raw } = captureLogs();
    const app = createApp({ config, logger });

    await request(app).get(
      '/api/v1/auth/callback/google?code=codigo-secreto-xyz&state=estado-secreto-abc',
    );

    const logs = raw.join('');
    expect(logs).toContain('callback/google');
    expect(logs).not.toContain('codigo-secreto-xyz');
    expect(logs).not.toContain('estado-secreto-abc');
  });
});

describe('perfil (updateUser)', () => {
  function update(agent: Awaited<ReturnType<typeof asUser>>, body: Record<string, unknown>) {
    return agent.post('/api/v1/auth/update-user').send(body);
  }

  it('edita o nome (com trim) e /me reflete', async () => {
    const agent = await asUser(await createUser({ name: 'Antigo' }));

    const res = await update(agent, { name: '  Maria Souza  ' });

    expect(res.status).toBe(200);
    const me = await agent.get('/api/v1/me');
    expect(me.body).toMatchObject({ name: 'Maria Souza' });
  });

  it.each([
    ['1 caractere', 'a'],
    ['80 caracteres', 'a'.repeat(80)],
  ])('aceita nome com %s', async (_nome, name) => {
    const agent = await asUser();
    expect((await update(agent, { name })).status).toBe(200);
  });

  it.each([
    ['vazio', ''],
    ['só espaços', '   '],
    ['81 caracteres', 'a'.repeat(81)],
    ['81 caracteres após trim', ` ${'a'.repeat(81)} `],
  ])('rejeita nome %s com 400 e não altera nada', async (_nome, name) => {
    const user = await createUser({ name: 'Intacto' });
    const agent = await asUser(user);

    const res = await update(agent, { name });

    expect(res.status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe('Intacto');
  });

  it('aceita imagem https e null; rejeita http e texto', async () => {
    const agent = await asUser(await createUser());

    expect((await update(agent, { image: 'https://img.exemplo.test/a.png' })).status).toBe(200);
    expect((await agent.get('/api/v1/me')).body).toMatchObject({
      image: 'https://img.exemplo.test/a.png',
    });

    for (const image of ['http://img.exemplo.test/a.png', 'não sou url', 'javascript:alert(1)']) {
      expect((await update(agent, { image })).status).toBe(400);
    }
    expect((await agent.get('/api/v1/me')).body).toMatchObject({
      image: 'https://img.exemplo.test/a.png',
    });

    expect((await update(agent, { image: null })).status).toBe(200);
    expect((await agent.get('/api/v1/me')).body).toMatchObject({ image: null });
  });

  it('o e-mail não muda e campos fora de nome e imagem são ignorados', async () => {
    const user = await createUser({ email: 'fixo@maratonei.test', emailVerified: false });
    const agent = await asUser(user);

    expect((await update(agent, { email: 'outro@maratonei.test' })).status).toBe(400);
    expect((await update(agent, { name: 'Ok', emailVerified: true })).status).toBe(200);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.email).toBe('fixo@maratonei.test');
    expect(after.emailVerified).toBe(false);
  });

  it('sem sessão: 401', async () => {
    const res = await client().post('/api/v1/auth/update-user').send({ name: 'X' });
    expect(res.status).toBe(401);
  });
});

describe('exclusão de conta (deleteUser)', () => {
  const old = () => new Date(Date.now() - 10 * 60 * 1000);

  it('sessão fresca: apaga o usuário e as dependências; /me volta a 401', async () => {
    const user = await createUser({ password: PASSWORD });
    await prisma.account.create({
      data: { userId: user.id, providerId: 'google', accountId: 'sub-apagar' },
    });
    const outra = await createUser();
    await createSession(outra);
    const agent = await asUser(user);
    await createSession(user);

    const res = await agent.post('/api/v1/auth/delete-user').send({});

    expect(res.status).toBe(200);
    expect((await agent.get('/api/v1/me')).status).toBe(401);
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
    expect(await prisma.account.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    // Outro usuário não é tocado.
    expect(await prisma.user.count({ where: { id: outra.id } })).toBe(1);
    expect(await prisma.session.count({ where: { userId: outra.id } })).toBe(1);
  });

  it('apaga as listas de que é dono (somem para os outros membros) e só o vínculo nas demais', async () => {
    const user = await createUser({ password: PASSWORD });
    const agent = await asUser(user);
    const other = await createUser();
    const otherAgent = await asUser(other);

    const owned = await createList({ owner: user });
    await createMembership(owned, { user: other });
    await createInvite(owned, { createdById: user.id });
    const shared = await createList({ owner: other });
    await createMembership(shared, { user });
    await createMembership(shared, { user: await createUser(), role: 'EDITOR' });
    await createInvite(shared, { createdById: user.id });

    expect((await otherAgent.get(`/api/v1/lists/${owned.id}`)).status).toBe(200);

    const res = await agent.post('/api/v1/auth/delete-user').send({});

    expect(res.status).toBe(200);
    // A lista do usuário some para o outro membro, com membros e convite.
    expect((await otherAgent.get(`/api/v1/lists/${owned.id}`)).status).toBe(404);
    expect(await prisma.list.count({ where: { id: owned.id } })).toBe(0);
    expect(await prisma.listMember.count({ where: { listId: owned.id } })).toBe(0);
    expect(await prisma.invite.count({ where: { listId: owned.id } })).toBe(0);
    // Na lista alheia só o vínculo dele some; o convite fica, sem autor.
    expect(await prisma.list.count({ where: { id: shared.id } })).toBe(1);
    expect(await prisma.listMember.count({ where: { listId: shared.id } })).toBe(2);
    expect(await prisma.listMember.count({ where: { userId: user.id } })).toBe(0);
    const invite = await prisma.invite.findFirstOrThrow({ where: { listId: shared.id } });
    expect(invite.createdById).toBeNull();
    expect((await otherAgent.get(`/api/v1/lists/${shared.id}`)).status).toBe(200);
  });

  it('sessão antiga sem senha: 400 SESSION_EXPIRED e nada é apagado', async () => {
    const user = await createUser({ password: PASSWORD });
    const agent = await asUser(user, undefined, { createdAt: old() });

    const res = await agent.post('/api/v1/auth/delete-user').send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
    expect((await agent.get('/api/v1/me')).status).toBe(200);
  });

  it('sessão antiga com a senha errada: 400 INVALID_PASSWORD e nada é apagado', async () => {
    const user = await createUser({ password: PASSWORD });
    const agent = await asUser(user, undefined, { createdAt: old() });

    const res = await agent.post('/api/v1/auth/delete-user').send({ password: 'senha-errada-99' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'INVALID_PASSWORD' });
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
  });

  it('sessão antiga com a senha certa: exclui', async () => {
    const user = await createUser({ password: PASSWORD });
    const agent = await asUser(user, undefined, { createdAt: old() });

    const res = await agent.post('/api/v1/auth/delete-user').send({ password: PASSWORD });

    expect(res.status).toBe(200);
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
    expect((await agent.get('/api/v1/me')).status).toBe(401);
  });

  it('sem sessão: 401; sem Origin permitido: 403', async () => {
    const user = await createUser();
    expect((await client().post('/api/v1/auth/delete-user').send({})).status).toBe(401);
    const session = await createSession(user);
    const semOrigin = await request(testApp())
      .post('/api/v1/auth/delete-user')
      .set('Cookie', sessionCookie(session))
      .send({});
    expect(semOrigin.status).toBe(403);
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
  });
});
