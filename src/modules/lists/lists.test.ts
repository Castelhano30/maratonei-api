import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { testApp } from '../../../test/helpers/app.js';
import { allowedOrigin, asUser } from '../../../test/helpers/as-user.js';
import { listScenario } from '../../../test/helpers/list-scenario.js';
import { createInvite, createList, createMembership } from '../../../test/factories/list.js';
import { createListItem } from '../../../test/factories/item.js';
import { createUser } from '../../../test/factories/user.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('sem sessão (401 UNAUTHENTICATED)', () => {
  const id = randomUUID();
  it.each([
    ['get', '/api/v1/lists'],
    ['post', '/api/v1/lists'],
    ['get', `/api/v1/lists/${id}`],
    ['patch', `/api/v1/lists/${id}`],
    ['delete', `/api/v1/lists/${id}`],
    ['get', `/api/v1/lists/${id}/members`],
    ['delete', `/api/v1/lists/${id}/members/me`],
    ['delete', `/api/v1/lists/${id}/members/${id}`],
    ['put', `/api/v1/lists/${id}/members/${id}/role`],
    ['get', `/api/v1/lists/${id}/invite`],
    ['post', `/api/v1/lists/${id}/invite`],
    ['delete', `/api/v1/lists/${id}/invite`],
    ['get', '/api/v1/invites/qualquer'],
    ['post', '/api/v1/invites/qualquer/accept'],
  ] as const)('%s %s', async (method, path) => {
    const client = request(testApp());
    const res = await client[method](path)
      .set('Origin', allowedOrigin())
      .send(method === 'get' || method === 'delete' ? undefined : {});
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('POST /lists (CAP-7)', () => {
  it('cria a lista e o criador vira OWNER', async () => {
    const agent = await asUser();

    const res = await agent
      .post('/api/v1/lists')
      .send({ name: '  Maratona de sábado  ', description: ' Filmes para ver juntos ' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Maratona de sábado',
      description: 'Filmes para ver juntos',
      ownerId: agent.user.id,
      role: 'OWNER',
    });
    expect(res.body.id).toMatch(UUID);
    const members = await prisma.listMember.findMany({ where: { listId: res.body.id } });
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: agent.user.id, role: 'OWNER' });
  });

  it('descrição é opcional e vazia vira null', async () => {
    const agent = await asUser();
    const semDescricao = await agent.post('/api/v1/lists').send({ name: 'A' });
    const vazia = await agent.post('/api/v1/lists').send({ name: 'B', description: '   ' });
    expect(semDescricao.body.description).toBeNull();
    expect(vazia.body.description).toBeNull();
  });

  it.each([
    ['1 caractere', 'a'],
    ['80 caracteres', 'a'.repeat(80)],
  ])('aceita nome com %s', async (_nome, name) => {
    const agent = await asUser();
    expect((await agent.post('/api/v1/lists').send({ name })).status).toBe(201);
  });

  it.each([
    ['vazio', ''],
    ['só espaços', '   '],
    ['81 caracteres', 'a'.repeat(81)],
    ['81 caracteres após trim', ` ${'a'.repeat(81)} `],
  ])('rejeita nome %s com 400', async (_nome, name) => {
    const agent = await asUser();
    const res = await agent.post('/api/v1/lists').send({ name });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await prisma.list.count()).toBe(0);
  });

  it('descrição: 500 caracteres passa, 501 não', async () => {
    const agent = await asUser();
    expect(
      (await agent.post('/api/v1/lists').send({ name: 'x', description: 'd'.repeat(500) })).status,
    ).toBe(201);
    expect(
      (await agent.post('/api/v1/lists').send({ name: 'x', description: 'd'.repeat(501) })).status,
    ).toBe(400);
  });
});

describe('GET /lists (CAP-7)', () => {
  it('lista só as listas do usuário, com papel, contagem de membros e itemCount real', async () => {
    const s = await listScenario();
    await createList(); // lista alheia
    const other = await createList({ owner: s.outsider.user });
    await createListItem(s.list);
    await createListItem(s.list);
    await createListItem(other); // item de outra lista não conta

    const res = await s.editor.get('/api/v1/lists');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(res.body.data).toEqual([
      {
        id: s.list.id,
        name: s.list.name,
        description: null,
        role: 'EDITOR',
        memberCount: 3,
        itemCount: 2,
        createdAt: s.list.createdAt.toISOString(),
        updatedAt: s.list.updatedAt.toISOString(),
      },
    ]);
    const ownerView = await s.outsider.get('/api/v1/lists');
    expect(ownerView.body.data.map((l: { id: string }) => l.id)).toEqual([other.id]);
  });

  it('ordena por updatedAt desc e pagina', async () => {
    const agent = await asUser();
    const a = await createList({ owner: agent.user, name: 'A' });
    const b = await createList({ owner: agent.user, name: 'B' });
    const c = await createList({ owner: agent.user, name: 'C' });
    await prisma.list.update({ where: { id: a.id }, data: { name: 'A2' } });

    const first = await agent.get('/api/v1/lists?pageSize=2');
    expect(first.body).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(first.body.data.map((l: { id: string }) => l.id)).toEqual([a.id, c.id]);

    const second = await agent.get('/api/v1/lists?pageSize=2&page=2');
    expect(second.body.data.map((l: { id: string }) => l.id)).toEqual([b.id]);

    const asc = await agent.get('/api/v1/lists?sort=updatedAt:asc');
    expect(asc.body.data.map((l: { id: string }) => l.id)).toEqual([b.id, c.id, a.id]);
  });

  it('pageSize acima de 100 ou sort inválido: 400', async () => {
    const agent = await asUser();
    expect((await agent.get('/api/v1/lists?pageSize=101')).status).toBe(400);
    expect((await agent.get('/api/v1/lists?sort=name:asc')).status).toBe(400);
  });
});

describe('matriz de permissões: ver lista', () => {
  it.each(['owner', 'editor', 'member'] as const)(
    '%s lê a lista com o próprio papel',
    async (who) => {
      const s = await listScenario();
      const res = await s[who].get(`/api/v1/lists/${s.list.id}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: s.list.id,
        ownerId: s.owner.user.id,
        role: who.toUpperCase(),
      });
    },
  );

  it('não membro: 404 LIST_NOT_FOUND', async () => {
    const s = await listScenario();
    const res = await s.outsider.get(`/api/v1/lists/${s.list.id}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
  });

  it('lista inexistente e id malformado têm a mesma resposta do não membro', async () => {
    const agent = await asUser();
    for (const id of [randomUUID(), 'nao-e-uuid']) {
      const res = await agent.get(`/api/v1/lists/${id}`);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
    }
  });

  it('acesso entre listas: membro da lista A não vê a lista B', async () => {
    const a = await listScenario();
    const b = await listScenario();
    for (const who of ['owner', 'editor', 'member'] as const) {
      const res = await a[who].get(`/api/v1/lists/${b.list.id}`);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
    }
  });
});

describe('matriz de permissões: renomear e editar a descrição (PATCH)', () => {
  it.each(['owner', 'editor'] as const)('%s edita (200)', async (who) => {
    const s = await listScenario();
    const res = await s[who]
      .patch(`/api/v1/lists/${s.list.id}`)
      .send({ name: ' Novo nome ', description: 'Nova descrição' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Novo nome',
      description: 'Nova descrição',
      role: who.toUpperCase(),
    });
    const stored = await prisma.list.findUniqueOrThrow({ where: { id: s.list.id } });
    expect(stored).toMatchObject({ name: 'Novo nome', description: 'Nova descrição' });
    expect(stored.ownerId).toBe(s.owner.user.id);
  });

  it('member: 403 INSUFFICIENT_ROLE e nada muda', async () => {
    const s = await listScenario();
    const res = await s.member.patch(`/api/v1/lists/${s.list.id}`).send({ name: 'Invasão' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'INSUFFICIENT_ROLE' });
    expect((await prisma.list.findUniqueOrThrow({ where: { id: s.list.id } })).name).toBe(
      s.list.name,
    );
  });

  it('não membro: 404 LIST_NOT_FOUND', async () => {
    const s = await listScenario();
    const res = await s.outsider.patch(`/api/v1/lists/${s.list.id}`).send({ name: 'Invasão' });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
  });

  it('edição parcial preserva o outro campo; description null limpa', async () => {
    const s = await listScenario();
    await s.owner.patch(`/api/v1/lists/${s.list.id}`).send({ description: 'Texto' });
    const renomeada = await s.owner.patch(`/api/v1/lists/${s.list.id}`).send({ name: 'Só nome' });
    expect(renomeada.body).toMatchObject({ name: 'Só nome', description: 'Texto' });
    const limpa = await s.owner.patch(`/api/v1/lists/${s.list.id}`).send({ description: null });
    expect(limpa.body.description).toBeNull();
  });

  it.each([
    ['corpo vazio', {}],
    ['nome vazio', { name: '  ' }],
    ['nome com 81 caracteres', { name: 'a'.repeat(81) }],
    ['descrição com 501 caracteres', { description: 'd'.repeat(501) }],
  ])('%s: 400 VALIDATION_FAILED', async (_nome, body) => {
    const s = await listScenario();
    const res = await s.owner.patch(`/api/v1/lists/${s.list.id}`).send(body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('o dono não muda por PATCH (ownerId é imutável)', async () => {
    const s = await listScenario();
    await s.owner
      .patch(`/api/v1/lists/${s.list.id}`)
      .send({ name: 'x', ownerId: s.member.user.id });
    expect((await prisma.list.findUniqueOrThrow({ where: { id: s.list.id } })).ownerId).toBe(
      s.owner.user.id,
    );
  });
});

describe('matriz de permissões: excluir lista (DELETE)', () => {
  it('owner: 204 e membros e convite somem em cascata', async () => {
    const s = await listScenario();
    await createInvite(s.list);
    const other = await createList();

    const res = await s.owner.delete(`/api/v1/lists/${s.list.id}`);

    expect(res.status).toBe(204);
    expect(await prisma.list.count({ where: { id: s.list.id } })).toBe(0);
    expect(await prisma.listMember.count({ where: { listId: s.list.id } })).toBe(0);
    expect(await prisma.invite.count({ where: { listId: s.list.id } })).toBe(0);
    // Os usuários continuam existindo e a outra lista não é tocada.
    expect(await prisma.user.count({ where: { id: s.member.user.id } })).toBe(1);
    expect(await prisma.list.count({ where: { id: other.id } })).toBe(1);
    expect((await s.member.get(`/api/v1/lists/${s.list.id}`)).status).toBe(404);
  });

  it.each(['editor', 'member'] as const)('%s: 403 INSUFFICIENT_ROLE', async (who) => {
    const s = await listScenario();
    const res = await s[who].delete(`/api/v1/lists/${s.list.id}`);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'INSUFFICIENT_ROLE' });
    expect(await prisma.list.count({ where: { id: s.list.id } })).toBe(1);
  });

  it('não membro: 404 LIST_NOT_FOUND', async () => {
    const s = await listScenario();
    const res = await s.outsider.delete(`/api/v1/lists/${s.list.id}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
    expect(await prisma.list.count({ where: { id: s.list.id } })).toBe(1);
  });
});

describe('exclusão de conta e listas (schema do banco)', () => {
  it('apagar o usuário apaga as listas de que é dono e só o vínculo nas demais', async () => {
    const s = await listScenario();
    const alheia = await createList();
    await createMembership(alheia, { user: s.owner.user });
    await createInvite(s.list, { createdById: s.owner.user.id });
    await createInvite(alheia, { createdById: s.owner.user.id });

    await prisma.user.delete({ where: { id: s.owner.user.id } });

    expect(await prisma.list.count({ where: { id: s.list.id } })).toBe(0);
    expect(await prisma.listMember.count({ where: { listId: s.list.id } })).toBe(0);
    expect(await prisma.list.count({ where: { id: alheia.id } })).toBe(1);
    expect(await prisma.listMember.count({ where: { listId: alheia.id } })).toBe(1);
    const invite = await prisma.invite.findFirstOrThrow({ where: { listId: alheia.id } });
    expect(invite.createdById).toBeNull();
  });
});

describe('integridade no banco', () => {
  it('só um OWNER por lista e um vínculo por usuário', async () => {
    const list = await createList();
    const other = await createUser();
    await expect(createMembership(list, { user: other, role: 'OWNER' })).rejects.toThrow();
    await createMembership(list, { user: other });
    await expect(createMembership(list, { user: other })).rejects.toThrow();
  });

  it('um único convite ativo por lista; revogados podem se acumular', async () => {
    const list = await createList();
    await createInvite(list);
    await expect(createInvite(list)).rejects.toThrow();
    await createInvite(list, { revoked: true });
    await createInvite(list, { revoked: true });
    expect(await prisma.invite.count({ where: { listId: list.id } })).toBe(3);
  });
});
