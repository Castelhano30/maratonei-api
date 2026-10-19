import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { testApp } from '../../../test/helpers/app.js';
import { allowedOrigin } from '../../../test/helpers/as-user.js';
import { listScenario } from '../../../test/helpers/list-scenario.js';
import { createListItem } from '../../../test/factories/item.js';
import { createList } from '../../../test/factories/list.js';
import { createRating } from '../../../test/factories/rating.js';

const base = (listId: string, itemId: string) => `/api/v1/lists/${listId}/items/${itemId}/ratings`;

describe('sem sessão (401 UNAUTHENTICATED)', () => {
  const id = randomUUID();
  it.each([
    ['get', base(id, id)],
    ['put', `${base(id, id)}/me`],
    ['delete', `${base(id, id)}/me`],
  ] as const)('%s %s', async (method, path) => {
    const client = request(testApp());
    const res = await client[method](path)
      .set('Origin', allowedOrigin())
      .send(method === 'put' ? { stars: 3 } : undefined);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('PUT /ratings/me (CAP-16)', () => {
  it('dono, editor e membro avaliam; reenviar edita a mesma nota', async () => {
    const s = await listScenario();
    const item = await createListItem(s.list);

    for (const [client, stars] of [
      [s.owner, 5],
      [s.editor, 4],
      [s.member, 2],
    ] as const) {
      const res = await client.put(`${base(s.list.id, item.id)}/me`).send({ stars });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        stars,
        member: { id: client.user.id, name: client.user.name, image: null },
      });
    }
    const edited = await s.member.put(`${base(s.list.id, item.id)}/me`).send({ stars: 3 });
    expect(edited.status).toBe(200);
    expect(edited.body.stars).toBe(3);
    expect(await prisma.rating.count({ where: { listItemId: item.id } })).toBe(3);
  });

  it.each([0, 6, 3.5, '4', null, undefined])('stars=%s → 400 VALIDATION_FAILED', async (stars) => {
    const s = await listScenario();
    const item = await createListItem(s.list);
    const res = await s.member.put(`${base(s.list.id, item.id)}/me`).send({ stars });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await prisma.rating.count()).toBe(0);
  });

  it('não membro → 404 LIST_NOT_FOUND, sem gravar nota', async () => {
    const s = await listScenario();
    const item = await createListItem(s.list);
    const res = await s.outsider.put(`${base(s.list.id, item.id)}/me`).send({ stars: 5 });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
    expect(await prisma.rating.count()).toBe(0);
  });

  it('item inexistente ou de outra lista → 404 ITEM_NOT_FOUND', async () => {
    const s = await listScenario();
    const otherList = await createList({ owner: s.owner.user });
    const foreign = await createListItem(otherList);

    const missing = await s.member.put(`${base(s.list.id, randomUUID())}/me`).send({ stars: 5 });
    const other = await s.member.put(`${base(s.list.id, foreign.id)}/me`).send({ stars: 5 });
    const malformed = await s.member.put(`${base(s.list.id, 'xyz')}/me`).send({ stars: 5 });

    for (const res of [missing, other, malformed]) {
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'ITEM_NOT_FOUND' });
    }
    expect(await prisma.rating.count()).toBe(0);
  });
});

describe('GET /ratings (CAP-16)', () => {
  it('lista a nota de cada membro e a média; sem notas → média null', async () => {
    const s = await listScenario();
    const item = await createListItem(s.list);

    const empty = await s.member.get(base(s.list.id, item.id));
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ average: null, count: 0, data: [] });

    await createRating(item, { id: s.ids.owner }, 5);
    await createRating(item, { id: s.ids.editor }, 4);
    await createRating(item, { id: s.ids.member }, 2);

    const res = await s.member.get(base(s.list.id, item.id));
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(res.body.average).toBeCloseTo(3.67, 2);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data.map((r: { member: { id: string } }) => r.member.id).sort()).toEqual(
      [s.owner.user.id, s.editor.user.id, s.member.user.id].sort(),
    );
    expect(res.body.data[0]).toEqual({
      member: expect.objectContaining({ id: expect.any(String), image: null }),
      stars: expect.any(Number),
      updatedAt: expect.any(String),
    });
  });

  it('não membro → 404 LIST_NOT_FOUND; nota de outra lista não vaza', async () => {
    const s = await listScenario();
    const item = await createListItem(s.list);
    await createRating(item, { id: s.ids.owner }, 5);

    const res = await s.outsider.get(base(s.list.id, item.id));
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
  });
});

describe('DELETE /ratings/me (CAP-16)', () => {
  it('remove só a própria nota e é idempotente', async () => {
    const s = await listScenario();
    const item = await createListItem(s.list);
    await createRating(item, { id: s.ids.owner }, 5);
    await createRating(item, { id: s.ids.member }, 1);

    const first = await s.member.delete(`${base(s.list.id, item.id)}/me`);
    const again = await s.member.delete(`${base(s.list.id, item.id)}/me`);

    expect(first.status).toBe(204);
    expect(again.status).toBe(204);
    const left = await prisma.rating.findMany({ where: { listItemId: item.id } });
    expect(left).toHaveLength(1);
    expect(left[0]?.memberId).toBe(s.ids.owner);
  });

  it('não membro → 404 e a nota fica', async () => {
    const s = await listScenario();
    const item = await createListItem(s.list);
    await createRating(item, { id: s.ids.member }, 3);

    const res = await s.outsider.delete(`${base(s.list.id, item.id)}/me`);
    expect(res.status).toBe(404);
    expect(await prisma.rating.count()).toBe(1);
  });
});

describe('cascatas', () => {
  it('sair da lista, remover o item e excluir a lista apagam as notas', async () => {
    const s = await listScenario();
    const a = await createListItem(s.list);
    const b = await createListItem(s.list);
    await createRating(a, { id: s.ids.member }, 3);
    await createRating(a, { id: s.ids.owner }, 5);
    await createRating(b, { id: s.ids.owner }, 4);

    await s.member.delete(`/api/v1/lists/${s.list.id}/members/me`);
    expect(await prisma.rating.count({ where: { memberId: s.ids.member } })).toBe(0);

    await prisma.listItem.delete({ where: { id: a.id } });
    expect(await prisma.rating.count()).toBe(1);

    await prisma.list.delete({ where: { id: s.list.id } });
    expect(await prisma.rating.count()).toBe(0);
  });

  it('o banco recusa estrelas fora de 1..5', async () => {
    const s = await listScenario();
    const item = await createListItem(s.list);
    await expect(createRating(item, { id: s.ids.owner }, 6)).rejects.toThrow();
  });
});
