import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { testApp } from '../../../test/helpers/app.js';
import { allowedOrigin } from '../../../test/helpers/as-user.js';
import { listScenario } from '../../../test/helpers/list-scenario.js';
import { createListItem } from '../../../test/factories/item.js';
import { createList } from '../../../test/factories/list.js';
import { createComment } from '../../../test/factories/rating.js';

const base = (listId: string, itemId: string) => `/api/v1/lists/${listId}/items/${itemId}/comments`;

describe('sem sessão (401 UNAUTHENTICATED)', () => {
  const id = randomUUID();
  it.each([
    ['get', base(id, id)],
    ['post', base(id, id)],
    ['patch', `${base(id, id)}/${id}`],
    ['delete', `${base(id, id)}/${id}`],
  ] as const)('%s %s', async (method, path) => {
    const client = request(testApp());
    const res = await client[method](path)
      .set('Origin', allowedOrigin())
      .send(method === 'get' || method === 'delete' ? undefined : { body: 'oi' });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('POST /comments (CAP-17)', () => {
  it('qualquer papel comenta; o autor é o usuário da sessão e o texto é aparado', async () => {
    const s = await listScenario();
    const item = await createListItem(s.list);

    for (const client of [s.owner, s.editor, s.member]) {
      const res = await client.post(base(s.list.id, item.id)).send({ body: '  Ótimo!  ' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        body: 'Ótimo!',
        author: { id: client.user.id, name: client.user.name, image: null },
      });
      expect(res.body.createdAt).toBe(res.body.updatedAt);
    }
    expect(await prisma.comment.count({ where: { listItemId: item.id } })).toBe(3);
  });

  it.each([
    ['vazio', { body: '' }],
    ['só espaços', { body: '   ' }],
    ['longo demais', { body: 'a'.repeat(2001) }],
    ['não string', { body: 5 }],
    ['sem body', {}],
  ])('body %s → 400 VALIDATION_FAILED', async (_name, payload) => {
    const s = await listScenario();
    const item = await createListItem(s.list);
    const res = await s.member.post(base(s.list.id, item.id)).send(payload);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await prisma.comment.count()).toBe(0);
  });

  it('aceita exatamente 2000 caracteres', async () => {
    const s = await listScenario();
    const item = await createListItem(s.list);
    const res = await s.member.post(base(s.list.id, item.id)).send({ body: 'a'.repeat(2000) });
    expect(res.status).toBe(201);
  });

  it('não membro → 404 LIST_NOT_FOUND; item de outra lista → 404 ITEM_NOT_FOUND', async () => {
    const s = await listScenario();
    const item = await createListItem(s.list);
    const otherList = await createList({ owner: s.owner.user });
    const foreign = await createListItem(otherList);

    const outsider = await s.outsider.post(base(s.list.id, item.id)).send({ body: 'oi' });
    const other = await s.member.post(base(s.list.id, foreign.id)).send({ body: 'oi' });

    expect(outsider.status).toBe(404);
    expect(outsider.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
    expect(other.status).toBe(404);
    expect(other.body).toMatchObject({ code: 'ITEM_NOT_FOUND' });
    expect(await prisma.comment.count()).toBe(0);
  });
});

describe('GET /comments (CAP-17)', () => {
  it('qualquer membro lê; pagina com total coerente, sem repetir nem pular', async () => {
    const s = await listScenario();
    const item = await createListItem(s.list);
    const other = await createListItem(s.list);
    const start = Date.parse('2026-01-01T00:00:00Z');
    for (let i = 0; i < 25; i++) {
      await createComment(
        item,
        { id: i % 2 ? s.ids.owner : s.ids.member },
        { body: `c${i}`, createdAt: new Date(start + i * 1000) },
      );
    }
    await createComment(other, { id: s.ids.owner }, { body: 'de outro item' });

    const p1 = await s.editor.get(`${base(s.list.id, item.id)}?pageSize=10`);
    const p2 = await s.editor.get(`${base(s.list.id, item.id)}?pageSize=10&page=2`);
    const p3 = await s.editor.get(`${base(s.list.id, item.id)}?pageSize=10&page=3`);

    expect(p1.status).toBe(200);
    expect(p1.body).toMatchObject({ page: 1, pageSize: 10, total: 25 });
    expect(p1.body.data[0]).toMatchObject({ body: 'c24' });
    expect(p3.body.data).toHaveLength(5);
    const bodies = [...p1.body.data, ...p2.body.data, ...p3.body.data].map(
      (c: { body: string }) => c.body,
    );
    expect(new Set(bodies).size).toBe(25);
    expect(bodies).not.toContain('de outro item');
  });

  it('sort=createdAt:asc inverte a ordem; padrão de pageSize é 20', async () => {
    const s = await listScenario();
    const item = await createListItem(s.list);
    for (let i = 0; i < 21; i++) {
      await createComment(
        item,
        { id: s.ids.owner },
        { body: `c${i}`, createdAt: new Date(Date.parse('2026-01-01T00:00:00Z') + i * 1000) },
      );
    }
    const res = await s.member.get(`${base(s.list.id, item.id)}?sort=createdAt:asc`);
    expect(res.body.pageSize).toBe(20);
    expect(res.body.data).toHaveLength(20);
    expect(res.body.data[0].body).toBe('c0');
  });

  it('parâmetros inválidos → 400; não membro → 404', async () => {
    const s = await listScenario();
    const item = await createListItem(s.list);
    const bad = await s.member.get(`${base(s.list.id, item.id)}?pageSize=101`);
    const badSort = await s.member.get(`${base(s.list.id, item.id)}?sort=body:asc`);
    const outsider = await s.outsider.get(base(s.list.id, item.id));

    expect(bad.status).toBe(400);
    expect(badSort.status).toBe(400);
    expect(outsider.status).toBe(404);
    expect(outsider.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
  });
});

describe('PATCH e DELETE /comments/:commentId (CAP-17)', () => {
  it('o autor edita (updatedAt avança) e exclui, em qualquer papel', async () => {
    const s = await listScenario();
    const item = await createListItem(s.list);

    for (const [client, memberId] of [
      [s.owner, s.ids.owner],
      [s.editor, s.ids.editor],
      [s.member, s.ids.member],
    ] as const) {
      const mine = await createComment(item, { id: memberId }, { body: 'antes' });
      const url = `${base(s.list.id, item.id)}/${mine.id}`;

      const patched = await client.patch(url).send({ body: ' depois ' });
      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({ id: mine.id, body: 'depois' });
      expect(patched.body.createdAt).toBe(mine.createdAt.toISOString());
      expect(Date.parse(patched.body.updatedAt)).toBeGreaterThan(mine.updatedAt.getTime());

      const deleted = await client.delete(url);
      expect(deleted.status).toBe(204);
      expect(await prisma.comment.findUnique({ where: { id: mine.id } })).toBeNull();
    }
  });

  it('comentário de outro membro → 403 NOT_OWN_RESOURCE, inclusive para o dono da lista; nada muda', async () => {
    const s = await listScenario();
    const item = await createListItem(s.list);
    const theirs = await createComment(item, { id: s.ids.member }, { body: 'meu' });
    const url = `${base(s.list.id, item.id)}/${theirs.id}`;

    for (const client of [s.owner, s.editor]) {
      const patch = await client.patch(url).send({ body: 'hack' });
      const del = await client.delete(url);
      expect(patch.status).toBe(403);
      expect(patch.body).toMatchObject({ code: 'NOT_OWN_RESOURCE' });
      expect(del.status).toBe(403);
      expect(del.body).toMatchObject({ code: 'NOT_OWN_RESOURCE' });
    }
    const row = await prisma.comment.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(row.body).toBe('meu');
  });

  it('não membro → 404 LIST_NOT_FOUND; inexistente ou de outro item → 404 COMMENT_NOT_FOUND', async () => {
    const s = await listScenario();
    const item = await createListItem(s.list);
    const other = await createListItem(s.list);
    const mine = await createComment(other, { id: s.ids.member });

    const outsider = await s.outsider
      .patch(`${base(s.list.id, other.id)}/${mine.id}`)
      .send({ body: 'x' });
    const missing = await s.member
      .patch(`${base(s.list.id, item.id)}/${randomUUID()}`)
      .send({ body: 'x' });
    const wrongItem = await s.member.delete(`${base(s.list.id, item.id)}/${mine.id}`);
    const malformed = await s.member.delete(`${base(s.list.id, item.id)}/nao-uuid`);

    expect(outsider.status).toBe(404);
    expect(outsider.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
    for (const res of [missing, wrongItem]) {
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'COMMENT_NOT_FOUND' });
    }
    expect(malformed.status).toBe(400);
    expect(await prisma.comment.count()).toBe(1);
  });

  it('body inválido na edição → 400 e o texto fica', async () => {
    const s = await listScenario();
    const item = await createListItem(s.list);
    const mine = await createComment(item, { id: s.ids.member }, { body: 'antes' });
    const res = await s.member.patch(`${base(s.list.id, item.id)}/${mine.id}`).send({ body: ' ' });
    expect(res.status).toBe(400);
    const row = await prisma.comment.findUniqueOrThrow({ where: { id: mine.id } });
    expect(row.body).toBe('antes');
  });
});

describe('cascatas', () => {
  it('sair da lista e remover o item apagam os comentários', async () => {
    const s = await listScenario();
    const item = await createListItem(s.list);
    const other = await createListItem(s.list);
    await createComment(item, { id: s.ids.member });
    await createComment(item, { id: s.ids.owner });
    await createComment(other, { id: s.ids.owner });

    await s.member.delete(`/api/v1/lists/${s.list.id}/members/me`);
    expect(await prisma.comment.count({ where: { memberId: s.ids.member } })).toBe(0);

    await prisma.listItem.delete({ where: { id: item.id } });
    expect(await prisma.comment.count()).toBe(1);
  });
});
