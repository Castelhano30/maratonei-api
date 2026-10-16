import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { config } from '../../config.js';
import { prisma } from '../../lib/prisma.js';
import { allowedOrigin, asUser, sessionCookie } from '../../../test/helpers/as-user.js';
import { captureLogs } from '../../../test/helpers/log-capture.js';
import { listScenario } from '../../../test/helpers/list-scenario.js';
import { addMember } from '../lists/index.js';
import { createInvite } from '../../../test/factories/list.js';
import { createSession } from '../../../test/factories/session.js';
import { createUser } from '../../../test/factories/user.js';

const BASE64URL_32_BYTES = /^[A-Za-z0-9_-]{43}$/;

describe('matriz de permissões: ver, gerar, rotacionar e revogar convite', () => {
  it('owner gera o convite (201) com token de 32 bytes em base64url', async () => {
    const s = await listScenario();
    const res = await s.owner.post(`/api/v1/lists/${s.list.id}/invite`).send();

    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(BASE64URL_32_BYTES);
    expect(Buffer.from(res.body.token, 'base64url')).toHaveLength(32);
    const stored = await prisma.invite.findFirstOrThrow({ where: { listId: s.list.id } });
    expect(stored).toMatchObject({ token: res.body.token, createdById: s.owner.user.id });
    expect(stored.revokedAt).toBeNull();
  });

  it('owner lê o convite ativo; sem convite: 404 INVITE_NOT_FOUND', async () => {
    const s = await listScenario();
    const vazio = await s.owner.get(`/api/v1/lists/${s.list.id}/invite`);
    expect(vazio.status).toBe(404);
    expect(vazio.body).toMatchObject({ code: 'INVITE_NOT_FOUND' });

    const criado = await s.owner.post(`/api/v1/lists/${s.list.id}/invite`).send();
    const lido = await s.owner.get(`/api/v1/lists/${s.list.id}/invite`);
    expect(lido.status).toBe(200);
    expect(lido.body).toEqual(criado.body);
  });

  it('owner revoga (204); revogar de novo: 404 INVITE_NOT_FOUND', async () => {
    const s = await listScenario();
    await s.owner.post(`/api/v1/lists/${s.list.id}/invite`).send();

    expect((await s.owner.delete(`/api/v1/lists/${s.list.id}/invite`)).status).toBe(204);
    expect((await s.owner.get(`/api/v1/lists/${s.list.id}/invite`)).status).toBe(404);
    const again = await s.owner.delete(`/api/v1/lists/${s.list.id}/invite`);
    expect(again.status).toBe(404);
    expect(again.body).toMatchObject({ code: 'INVITE_NOT_FOUND' });
  });

  it.each(['editor', 'member'] as const)(
    '%s: 403 INSUFFICIENT_ROLE em GET, POST e DELETE',
    async (who) => {
      const s = await listScenario();
      await createInvite(s.list);
      for (const method of ['get', 'post', 'delete'] as const) {
        const res = await s[who][method](`/api/v1/lists/${s.list.id}/invite`);
        expect(res.status, method).toBe(403);
        expect(res.body).toMatchObject({ code: 'INSUFFICIENT_ROLE' });
      }
      expect(await prisma.invite.count({ where: { listId: s.list.id, revokedAt: null } })).toBe(1);
    },
  );

  it('não membro: 404 LIST_NOT_FOUND em GET, POST e DELETE', async () => {
    const s = await listScenario();
    await createInvite(s.list);
    for (const method of ['get', 'post', 'delete'] as const) {
      const res = await s.outsider[method](`/api/v1/lists/${s.list.id}/invite`);
      expect(res.status, method).toBe(404);
      expect(res.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
    }
    expect(await prisma.invite.count({ where: { listId: s.list.id, revokedAt: null } })).toBe(1);
  });

  it('o dono da lista A não mexe no convite da lista B', async () => {
    const a = await listScenario();
    const b = await listScenario();
    await createInvite(b.list);
    const res = await a.owner.delete(`/api/v1/lists/${b.list.id}/invite`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
    expect(await prisma.invite.count({ where: { listId: b.list.id, revokedAt: null } })).toBe(1);
  });
});

describe('rotação (CAP-10)', () => {
  it('gerar de novo revoga o anterior: o token antigo vira 404 INVITE_NOT_FOUND', async () => {
    const s = await listScenario();
    const first = await s.owner.post(`/api/v1/lists/${s.list.id}/invite`).send();
    const second = await s.owner.post(`/api/v1/lists/${s.list.id}/invite`).send();
    expect(second.body.token).not.toBe(first.body.token);

    const oldPreview = await s.outsider.get(`/api/v1/invites/${first.body.token}`);
    expect(oldPreview.status).toBe(404);
    expect(oldPreview.body).toMatchObject({ code: 'INVITE_NOT_FOUND' });
    const oldAccept = await s.outsider.post(`/api/v1/invites/${first.body.token}/accept`).send();
    expect(oldAccept.status).toBe(404);
    expect(await prisma.listMember.count({ where: { listId: s.list.id } })).toBe(3);

    const newPreview = await s.outsider.get(`/api/v1/invites/${second.body.token}`);
    expect(newPreview.status).toBe(200);
    expect(await prisma.invite.count({ where: { listId: s.list.id, revokedAt: null } })).toBe(1);
  });

  it('gerações concorrentes terminam com exatamente um convite ativo', async () => {
    const s = await listScenario();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => s.owner.post(`/api/v1/lists/${s.list.id}/invite`).send()),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await prisma.invite.count({ where: { listId: s.list.id, revokedAt: null } })).toBe(1);
  });

  it('o convite é por lista: gerar numa não toca na outra', async () => {
    const a = await listScenario();
    const b = await listScenario();
    const inviteB = await b.owner.post(`/api/v1/lists/${b.list.id}/invite`).send();
    await a.owner.post(`/api/v1/lists/${a.list.id}/invite`).send();
    expect((await a.outsider.get(`/api/v1/invites/${inviteB.body.token}`)).status).toBe(200);
  });
});

describe('GET /invites/:token', () => {
  it('devolve listId, listName e alreadyMember=false para quem não é membro', async () => {
    const s = await listScenario();
    const { body } = await s.owner.post(`/api/v1/lists/${s.list.id}/invite`).send();

    const res = await s.outsider.get(`/api/v1/invites/${body.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ listId: s.list.id, listName: s.list.name, alreadyMember: false });
    // A prévia não adiciona ninguém.
    expect(await prisma.listMember.count({ where: { listId: s.list.id } })).toBe(3);
  });

  it.each(['owner', 'editor', 'member'] as const)(
    '%s já é membro: alreadyMember=true',
    async (who) => {
      const s = await listScenario();
      const { body } = await s.owner.post(`/api/v1/lists/${s.list.id}/invite`).send();
      const res = await s[who].get(`/api/v1/invites/${body.token}`);
      expect(res.body).toMatchObject({ alreadyMember: true });
    },
  );

  it('token inexistente, revogado ou malformado: 404 INVITE_NOT_FOUND', async () => {
    const s = await listScenario();
    const revogado = await createInvite(s.list, { revoked: true });
    for (const token of ['inexistente', revogado.token, randomUUID()]) {
      const res = await s.outsider.get(`/api/v1/invites/${token}`);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'INVITE_NOT_FOUND' });
    }
  });
});

describe('POST /invites/:token/accept', () => {
  it('vira MEMBER e o segundo aceite é idempotente (alreadyMember=true)', async () => {
    const s = await listScenario();
    const { body } = await s.owner.post(`/api/v1/lists/${s.list.id}/invite`).send();

    const first = await s.outsider.post(`/api/v1/invites/${body.token}/accept`).send();
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ listId: s.list.id, listName: s.list.name, alreadyMember: false });
    const membership = await prisma.listMember.findFirstOrThrow({
      where: { listId: s.list.id, userId: s.outsider.user.id },
    });
    expect(membership.role).toBe('MEMBER');
    expect((await s.outsider.get(`/api/v1/lists/${s.list.id}`)).status).toBe(200);

    const second = await s.outsider.post(`/api/v1/invites/${body.token}/accept`).send();
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ listId: s.list.id, listName: s.list.name, alreadyMember: true });
    expect(await prisma.listMember.count({ where: { listId: s.list.id } })).toBe(4);
  });

  it('quem já é editor ou dono não é rebaixado pelo aceite', async () => {
    const s = await listScenario();
    const { body } = await s.owner.post(`/api/v1/lists/${s.list.id}/invite`).send();
    for (const who of ['owner', 'editor'] as const) {
      const res = await s[who].post(`/api/v1/invites/${body.token}/accept`).send();
      expect(res.body).toMatchObject({ alreadyMember: true });
    }
    const roles = await prisma.listMember.findMany({
      where: { listId: s.list.id },
      orderBy: { joinedAt: 'asc' },
    });
    expect(roles.map((m) => m.role)).toEqual(['OWNER', 'EDITOR', 'MEMBER']);
  });

  it('aceites concorrentes do mesmo usuário geram um só vínculo', async () => {
    const s = await listScenario();
    const { body } = await s.owner.post(`/api/v1/lists/${s.list.id}/invite`).send();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        s.outsider.post(`/api/v1/invites/${body.token}/accept`).send(),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(
      await prisma.listMember.count({
        where: { listId: s.list.id, userId: s.outsider.user.id },
      }),
    ).toBe(1);
  });

  it('convite revogado: 404 INVITE_NOT_FOUND e ninguém entra', async () => {
    const s = await listScenario();
    const { body } = await s.owner.post(`/api/v1/lists/${s.list.id}/invite`).send();
    await s.owner.delete(`/api/v1/lists/${s.list.id}/invite`);

    const res = await s.outsider.post(`/api/v1/invites/${body.token}/accept`).send();
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'INVITE_NOT_FOUND' });
    expect(await prisma.listMember.count({ where: { listId: s.list.id } })).toBe(3);
  });

  it('o aceite exige Origin permitido', async () => {
    const s = await listScenario();
    const { body } = await s.owner.post(`/api/v1/lists/${s.list.id}/invite`).send();
    const res = await request(createApp())
      .post(`/api/v1/invites/${body.token}/accept`)
      .set('Cookie', sessionCookie(s.outsider.session))
      .send();
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'ORIGIN_REJECTED' });
  });

  describe('MAX_LIST_MEMBERS', () => {
    const original = config.MAX_LIST_MEMBERS;
    afterEach(() => {
      config.MAX_LIST_MEMBERS = original;
    });

    it('lista cheia: 409 LIST_MEMBER_LIMIT; quem já é membro continua recebendo 200', async () => {
      const s = await listScenario(); // 3 membros
      const { body } = await s.owner.post(`/api/v1/lists/${s.list.id}/invite`).send();
      config.MAX_LIST_MEMBERS = 3;

      const res = await s.outsider.post(`/api/v1/invites/${body.token}/accept`).send();
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'LIST_MEMBER_LIMIT' });
      expect(await prisma.listMember.count({ where: { listId: s.list.id } })).toBe(3);

      const already = await s.member.post(`/api/v1/invites/${body.token}/accept`).send();
      expect(already.status).toBe(200);
      expect(already.body).toMatchObject({ alreadyMember: true });
    });

    it('com uma vaga e aceites concorrentes, só um entra (lock da linha da lista)', async () => {
      const s = await listScenario();
      const { body } = await s.owner.post(`/api/v1/lists/${s.list.id}/invite`).send();
      config.MAX_LIST_MEMBERS = 4;
      const candidates = await Promise.all(
        Array.from({ length: 4 }, async () => asUser(await createUser())),
      );

      const results = await Promise.all(
        candidates.map((c) => c.post(`/api/v1/invites/${body.token}/accept`).send()),
      );

      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
      expect(await prisma.listMember.count({ where: { listId: s.list.id } })).toBe(4);
    });
  });
});

describe('revogação entre a leitura do token e o aceite', () => {
  it('addMember com o token já revogado falha com INVITE_NOT_FOUND e ninguém entra', async () => {
    const s = await listScenario();
    const { body } = await s.owner.post(`/api/v1/lists/${s.list.id}/invite`).send();
    // Simula a corrida: o token foi lido ativo e o dono revogou antes da trava.
    await s.owner.delete(`/api/v1/lists/${s.list.id}/invite`);

    await expect(
      addMember(s.list.id, s.outsider.user.id, { inviteToken: body.token }),
    ).rejects.toMatchObject({ code: 'INVITE_NOT_FOUND' });
    expect(await prisma.listMember.count({ where: { listId: s.list.id } })).toBe(3);
  });

  it('token rotacionado também é recusado dentro da trava', async () => {
    const s = await listScenario();
    const { body } = await s.owner.post(`/api/v1/lists/${s.list.id}/invite`).send();
    await s.owner.post(`/api/v1/lists/${s.list.id}/invite`).send();

    await expect(
      addMember(s.list.id, s.outsider.user.id, { inviteToken: body.token }),
    ).rejects.toMatchObject({ code: 'INVITE_NOT_FOUND' });
  });

  it('revogações concorrentes: uma 204 e as demais 404, sem convite ativo', async () => {
    const s = await listScenario();
    await s.owner.post(`/api/v1/lists/${s.list.id}/invite`).send();
    const results = await Promise.all(
      Array.from({ length: 3 }, () => s.owner.delete(`/api/v1/lists/${s.list.id}/invite`)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([204, 404, 404]);
  });
});

describe('o token não vaza nos logs', () => {
  it('a URL do convite sai mascarada', async () => {
    const s = await listScenario();
    const { body } = await s.owner.post(`/api/v1/lists/${s.list.id}/invite`).send();
    const { logger, raw } = captureLogs();
    const app = createApp({ config, logger });
    const session = await createSession(await createUser());

    await request(app)
      .post(`/api/v1/invites/${body.token}/accept`)
      .set('Origin', allowedOrigin())
      .set('Cookie', sessionCookie(session))
      .send();

    const logs = raw.join('');
    expect(logs).toContain('/invites/');
    expect(logs).not.toContain(body.token);
  });
});

describe('integração com membros', () => {
  it('quem entra pelo convite aparece na listagem de membros', async () => {
    const s = await listScenario();
    const { body } = await s.owner.post(`/api/v1/lists/${s.list.id}/invite`).send();
    await s.outsider.post(`/api/v1/invites/${body.token}/accept`).send();

    const res = await s.owner.get(`/api/v1/lists/${s.list.id}/members`);
    expect(res.body.total).toBe(4);
    expect(res.body.data.at(-1)).toMatchObject({
      user: { id: s.outsider.user.id },
      role: 'MEMBER',
    });
    const lists = await s.outsider.get('/api/v1/lists');
    expect(lists.body.data[0]).toMatchObject({ id: s.list.id, role: 'MEMBER', memberCount: 4 });
  });
});
