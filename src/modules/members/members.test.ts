import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { listScenario } from '../../../test/helpers/list-scenario.js';
import { createList, createMembership } from '../../../test/factories/list.js';

describe('GET /lists/:listId/members (CAP-8)', () => {
  it.each(['owner', 'editor', 'member'] as const)('%s vê nome, avatar e papel', async (who) => {
    const s = await listScenario();
    const res = await s[who].get(`/api/v1/lists/${s.list.id}/members`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 3 });
    expect(res.body.data).toEqual([
      {
        id: s.ids.owner,
        user: { id: s.owner.user.id, name: s.owner.user.name, image: null },
        role: 'OWNER',
        joinedAt: expect.any(String),
      },
      {
        id: s.ids.editor,
        user: { id: s.editor.user.id, name: s.editor.user.name, image: null },
        role: 'EDITOR',
        joinedAt: expect.any(String),
      },
      {
        id: s.ids.member,
        user: { id: s.member.user.id, name: s.member.user.name, image: null },
        role: 'MEMBER',
        joinedAt: expect.any(String),
      },
    ]);
    // Nunca expõe e-mail.
    expect(JSON.stringify(res.body)).not.toContain(s.owner.user.email);
  });

  it('pagina', async () => {
    const s = await listScenario();
    const res = await s.owner.get(`/api/v1/lists/${s.list.id}/members?pageSize=2&page=2`);
    expect(res.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(res.body.data.map((m: { id: string }) => m.id)).toEqual([s.ids.member]);
  });

  it('não membro e lista inexistente: 404 LIST_NOT_FOUND', async () => {
    const s = await listScenario();
    for (const id of [s.list.id, randomUUID()]) {
      const res = await s.outsider.get(`/api/v1/lists/${id}/members`);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
    }
  });
});

describe('DELETE /lists/:listId/members/me (sair)', () => {
  it.each(['editor', 'member'] as const)('%s sai e perde o acesso', async (who) => {
    const s = await listScenario();
    const res = await s[who].delete(`/api/v1/lists/${s.list.id}/members/me`);

    expect(res.status).toBe(204);
    expect(await prisma.listMember.count({ where: { listId: s.list.id } })).toBe(2);
    expect((await s[who].get(`/api/v1/lists/${s.list.id}`)).status).toBe(404);
    // A conta continua existindo.
    expect(await prisma.user.count({ where: { id: s[who].user.id } })).toBe(1);
  });

  it('o literal "me" não é tratado como :memberId (não é 400 de UUID)', async () => {
    const s = await listScenario();
    const res = await s.member.delete(`/api/v1/lists/${s.list.id}/members/me`);
    expect(res.status).toBe(204);
  });

  it('dono: 403 OWNER_IMMUTABLE e o vínculo permanece', async () => {
    const s = await listScenario();
    const res = await s.owner.delete(`/api/v1/lists/${s.list.id}/members/me`);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'OWNER_IMMUTABLE' });
    expect(await prisma.listMember.count({ where: { id: s.ids.owner } })).toBe(1);
  });

  it('não membro: 404 LIST_NOT_FOUND', async () => {
    const s = await listScenario();
    const res = await s.outsider.delete(`/api/v1/lists/${s.list.id}/members/me`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
  });

  it('quem saiu volta a entrar pelo convite como MEMBER, sem o papel anterior', async () => {
    const s = await listScenario();
    await s.editor.delete(`/api/v1/lists/${s.list.id}/members/me`);
    const invite = await s.owner.post(`/api/v1/lists/${s.list.id}/invite`).send();
    await s.editor.post(`/api/v1/invites/${invite.body.token}/accept`).send();

    const res = await s.editor.get(`/api/v1/lists/${s.list.id}`);
    expect(res.body).toMatchObject({ role: 'MEMBER' });
  });
});

describe('DELETE /lists/:listId/members/:memberId (remover)', () => {
  it.each(['editor', 'member'] as const)('owner remove o %s', async (target) => {
    const s = await listScenario();
    const res = await s.owner.delete(`/api/v1/lists/${s.list.id}/members/${s.ids[target]}`);

    expect(res.status).toBe(204);
    expect(await prisma.listMember.count({ where: { id: s.ids[target] } })).toBe(0);
    expect((await s[target].get(`/api/v1/lists/${s.list.id}`)).status).toBe(404);
  });

  it.each(['editor', 'member'] as const)('%s: 403 INSUFFICIENT_ROLE', async (who) => {
    const s = await listScenario();
    const res = await s[who].delete(`/api/v1/lists/${s.list.id}/members/${s.ids.member}`);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'INSUFFICIENT_ROLE' });
    expect(await prisma.listMember.count({ where: { listId: s.list.id } })).toBe(3);
  });

  it('não membro: 404 LIST_NOT_FOUND', async () => {
    const s = await listScenario();
    const res = await s.outsider.delete(`/api/v1/lists/${s.list.id}/members/${s.ids.member}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
  });

  it('alvo dono: 403 OWNER_IMMUTABLE', async () => {
    const s = await listScenario();
    const res = await s.owner.delete(`/api/v1/lists/${s.list.id}/members/${s.ids.owner}`);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'OWNER_IMMUTABLE' });
    expect(await prisma.listMember.count({ where: { id: s.ids.owner } })).toBe(1);
  });

  it('membro inexistente ou de outra lista: 404 MEMBER_NOT_FOUND', async () => {
    const s = await listScenario();
    const outra = await createList();
    const intruso = await createMembership(outra);
    for (const id of [randomUUID(), intruso.id]) {
      const res = await s.owner.delete(`/api/v1/lists/${s.list.id}/members/${id}`);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'MEMBER_NOT_FOUND' });
    }
    expect(await prisma.listMember.count({ where: { id: intruso.id } })).toBe(1);
  });

  it('memberId malformado: 400 VALIDATION_FAILED', async () => {
    const s = await listScenario();
    const res = await s.owner.delete(`/api/v1/lists/${s.list.id}/members/nao-e-uuid`);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('o dono da lista A não remove membro da lista B', async () => {
    const a = await listScenario();
    const b = await listScenario();
    const res = await a.owner.delete(`/api/v1/lists/${b.list.id}/members/${b.ids.member}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
    expect(await prisma.listMember.count({ where: { id: b.ids.member } })).toBe(1);
  });
});

describe('PUT /lists/:listId/members/:memberId/role (CAP-9)', () => {
  it('owner concede editor; o membro passa a ter permissões de editor', async () => {
    const s = await listScenario();
    expect(
      (await s.member.patch(`/api/v1/lists/${s.list.id}`).send({ name: 'Antes' })).status,
    ).toBe(403);

    const res = await s.owner
      .put(`/api/v1/lists/${s.list.id}/members/${s.ids.member}/role`)
      .send({ role: 'EDITOR' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: s.ids.member,
      role: 'EDITOR',
      user: { id: s.member.user.id },
    });
    expect(
      (await s.member.patch(`/api/v1/lists/${s.list.id}`).send({ name: 'Depois' })).status,
    ).toBe(200);
  });

  it('owner revoga editor; o editor volta a receber 403 INSUFFICIENT_ROLE', async () => {
    const s = await listScenario();
    const res = await s.owner
      .put(`/api/v1/lists/${s.list.id}/members/${s.ids.editor}/role`)
      .send({ role: 'MEMBER' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'MEMBER' });

    const denied = await s.editor.patch(`/api/v1/lists/${s.list.id}`).send({ name: 'x' });
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'INSUFFICIENT_ROLE' });
  });

  it('o papel vale só naquela lista', async () => {
    const s = await listScenario();
    const outra = await createList();
    await createMembership(outra, { user: s.member.user });
    await s.owner
      .put(`/api/v1/lists/${s.list.id}/members/${s.ids.member}/role`)
      .send({ role: 'EDITOR' });

    const res = await s.member.patch(`/api/v1/lists/${outra.id}`).send({ name: 'x' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'INSUFFICIENT_ROLE' });
  });

  it.each(['editor', 'member'] as const)('%s: 403 INSUFFICIENT_ROLE', async (who) => {
    const s = await listScenario();
    const res = await s[who]
      .put(`/api/v1/lists/${s.list.id}/members/${s.ids.member}/role`)
      .send({ role: 'EDITOR' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'INSUFFICIENT_ROLE' });
    expect((await prisma.listMember.findUniqueOrThrow({ where: { id: s.ids.member } })).role).toBe(
      'MEMBER',
    );
  });

  it('não membro: 404 LIST_NOT_FOUND', async () => {
    const s = await listScenario();
    const res = await s.outsider
      .put(`/api/v1/lists/${s.list.id}/members/${s.ids.member}/role`)
      .send({ role: 'EDITOR' });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
  });

  it('alvo dono (inclusive o próprio dono): 403 OWNER_IMMUTABLE', async () => {
    const s = await listScenario();
    const res = await s.owner
      .put(`/api/v1/lists/${s.list.id}/members/${s.ids.owner}/role`)
      .send({ role: 'MEMBER' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'OWNER_IMMUTABLE' });
    expect((await prisma.listMember.findUniqueOrThrow({ where: { id: s.ids.owner } })).role).toBe(
      'OWNER',
    );
  });

  it('OWNER não é um papel concedível; corpo inválido: 400', async () => {
    const s = await listScenario();
    for (const body of [{ role: 'OWNER' }, { role: 'ADMIN' }, {}]) {
      const res = await s.owner
        .put(`/api/v1/lists/${s.list.id}/members/${s.ids.member}/role`)
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });

  it('membro inexistente ou de outra lista: 404 MEMBER_NOT_FOUND', async () => {
    const s = await listScenario();
    const intruso = await createMembership(await createList());
    for (const id of [randomUUID(), intruso.id]) {
      const res = await s.owner
        .put(`/api/v1/lists/${s.list.id}/members/${id}/role`)
        .send({ role: 'EDITOR' });
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'MEMBER_NOT_FOUND' });
    }
  });
});
