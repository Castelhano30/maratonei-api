import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { testApp } from '../../../test/helpers/app.js';
import { allowedOrigin } from '../../../test/helpers/as-user.js';
import { listScenario } from '../../../test/helpers/list-scenario.js';
import { fakeTmdb } from '../../../test/helpers/tmdb.js';
import { movieDetail, tvDetail } from '../../../test/fakes/tmdb-client.js';
import { createListItem } from '../../../test/factories/item.js';
import { createList, createMembership } from '../../../test/factories/list.js';
import { createRating } from '../../../test/factories/rating.js';
import { createTitle } from '../../../test/factories/title.js';
import { createUser } from '../../../test/factories/user.js';

const base = (listId: string) => `/api/v1/lists/${listId}/items`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('sem sessão (401 UNAUTHENTICATED)', () => {
  const id = randomUUID();
  it.each([
    ['get', base(id)],
    ['post', base(id)],
    ['get', `${base(id)}/${id}`],
    ['put', `${base(id)}/${id}/status`],
    ['patch', `${base(id)}/${id}`],
    ['delete', `${base(id)}/${id}`],
  ] as const)('%s %s', async (method, path) => {
    const client = request(testApp());
    const res = await client[method](path)
      .set('Origin', allowedOrigin())
      .send(method === 'get' || method === 'delete' ? undefined : {});
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('POST /lists/:listId/items (CAP-13)', () => {
  it('dono e editor adicionam; o item nasce WANT, com título, autor e sem notas', async () => {
    fakeTmdb.add(movieDetail(), tvDetail());
    const s = await listScenario();

    const owner = await s.owner.post(base(s.list.id)).send({ mediaType: 'MOVIE', tmdbId: 438631 });
    const editor = await s.editor.post(base(s.list.id)).send({ mediaType: 'TV', tmdbId: 70523 });

    expect(owner.status).toBe(201);
    expect(owner.body).toMatchObject({
      status: 'WANT',
      title: { tmdbId: 438631, mediaType: 'MOVIE', name: 'Duna', genreIds: [878, 12] },
      addedBy: { id: s.owner.user.id, name: s.owner.user.name, image: null },
      ratingAverage: null,
      ratingCount: 0,
    });
    expect(owner.body.id).toMatch(UUID);
    expect(editor.status).toBe(201);
    expect(editor.body.addedBy.id).toBe(s.editor.user.id);
    expect(await prisma.listItem.count({ where: { listId: s.list.id } })).toBe(2);
  });

  it('membro comum → 403 INSUFFICIENT_ROLE; não membro → 404 LIST_NOT_FOUND', async () => {
    fakeTmdb.add(movieDetail());
    const s = await listScenario();
    const body = { mediaType: 'MOVIE', tmdbId: 438631 };

    const member = await s.member.post(base(s.list.id)).send(body);
    const outsider = await s.outsider.post(base(s.list.id)).send(body);

    expect(member.status).toBe(403);
    expect(member.body).toMatchObject({ code: 'INSUFFICIENT_ROLE' });
    expect(outsider.status).toBe(404);
    expect(outsider.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
    expect(await prisma.listItem.count()).toBe(0);
    expect(fakeTmdb.getTitleCalls).toHaveLength(0);
  });

  it('duplicado na mesma lista → 409 TITLE_ALREADY_IN_LIST; em outra lista é permitido', async () => {
    fakeTmdb.add(movieDetail());
    const s = await listScenario();
    const otherList = await createList({ owner: s.owner.user });
    const body = { mediaType: 'MOVIE', tmdbId: 438631 };

    await s.owner.post(base(s.list.id)).send(body).expect(201);
    const again = await s.editor.post(base(s.list.id)).send(body);
    const elsewhere = await s.owner.post(base(otherList.id)).send(body);

    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'TITLE_ALREADY_IN_LIST' });
    expect(elsewhere.status).toBe(201);
    expect(await prisma.title.count()).toBe(1);
  });

  it('a unique do banco também vira 409 quando a checagem prévia é ultrapassada', async () => {
    fakeTmdb.add(movieDetail());
    const s = await listScenario();
    const body = { mediaType: 'MOVIE', tmdbId: 438631 };

    const results = await Promise.all([
      s.owner.post(base(s.list.id)).send(body),
      s.editor.post(base(s.list.id)).send(body),
      s.owner.post(base(s.list.id)).send(body),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await prisma.listItem.count()).toBe(1);
  });

  it('título desconhecido do TMDB → 404 TITLE_NOT_FOUND', async () => {
    const s = await listScenario();
    const res = await s.owner.post(base(s.list.id)).send({ mediaType: 'MOVIE', tmdbId: 1 });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'TITLE_NOT_FOUND' });
  });

  it('TMDB fora sem cache → 503 e nada é criado', async () => {
    fakeTmdb.setDown(true);
    const s = await listScenario();
    const res = await s.owner.post(base(s.list.id)).send({ mediaType: 'MOVIE', tmdbId: 438631 });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'TMDB_UNAVAILABLE' });
    expect(await prisma.listItem.count()).toBe(0);
  });

  it('TMDB fora com Title em cache → 201 a partir do cache', async () => {
    await createTitle({ tmdbId: 438631, name: 'Duna (cache)', releaseYear: 2021 });
    fakeTmdb.setDown(true);
    const s = await listScenario();
    const res = await s.owner.post(base(s.list.id)).send({ mediaType: 'MOVIE', tmdbId: 438631 });
    expect(res.status).toBe(201);
    expect(res.body.title.name).toBe('Duna (cache)');
  });

  it.each([
    [{}, 'vazio'],
    [{ mediaType: 'MOVIE' }, 'sem tmdbId'],
    [{ mediaType: 'BOOK', tmdbId: 1 }, 'mediaType inválido'],
    [{ mediaType: 'MOVIE', tmdbId: '438631' }, 'tmdbId como string'],
    [{ mediaType: 'MOVIE', tmdbId: 0 }, 'tmdbId 0'],
    [{ mediaType: 'MOVIE', tmdbId: 1.5 }, 'tmdbId fracionário'],
  ])('400 VALIDATION_FAILED: %j (%s)', async (body, _label) => {
    const s = await listScenario();
    const res = await s.owner.post(base(s.list.id)).send(body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('GET /lists/:listId/items (CAP-14)', () => {
  it('qualquer membro lista; não membro → 404; lista inexistente → 404', async () => {
    const s = await listScenario();
    await createListItem(s.list, { addedById: s.owner.user.id });

    for (const client of [s.owner, s.editor, s.member]) {
      const res = await client.get(base(s.list.id));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
      expect(res.body.data).toHaveLength(1);
    }
    const outsider = await s.outsider.get(base(s.list.id));
    expect(outsider.status).toBe(404);
    expect(outsider.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
    expect((await s.owner.get(base(randomUUID()))).status).toBe(404);
  });

  it('só devolve itens da própria lista (acesso entre listas)', async () => {
    const s = await listScenario();
    const other = await createList({ owner: s.owner.user });
    await createListItem(s.list);
    await createListItem(other);
    await createListItem(other);

    const res = await s.owner.get(base(s.list.id));
    expect(res.body.total).toBe(1);
  });

  async function seeded() {
    const s = await listScenario();
    const t = (offset: number) => new Date(Date.UTC(2026, 0, 1 + offset));
    const duna = await createListItem(s.list, {
      titleInput: { name: 'Duna', mediaType: 'MOVIE', genreIds: [878, 12] },
      status: 'WANT',
      addedAt: t(0),
    });
    const dark = await createListItem(s.list, {
      titleInput: { name: 'Dark', mediaType: 'TV', genreIds: [9648, 18] },
      status: 'WATCHING',
      addedAt: t(1),
    });
    const alien = await createListItem(s.list, {
      titleInput: { name: 'Alien', mediaType: 'MOVIE', genreIds: [878, 27] },
      status: 'WATCHED',
      addedAt: t(2),
    });
    return { s, duna, dark, alien };
  }

  const names = (body: { data: { title: { name: string } }[] }) =>
    body.data.map((item) => item.title.name);

  it('ordena por addedAt:desc por padrão e aceita addedAt:asc', async () => {
    const { s } = await seeded();
    expect(names((await s.member.get(base(s.list.id))).body)).toEqual(['Alien', 'Dark', 'Duna']);
    const asc = await s.member.get(base(s.list.id)).query({ sort: 'addedAt:asc' });
    expect(names(asc.body)).toEqual(['Duna', 'Dark', 'Alien']);
  });

  it('filtra por status', async () => {
    const { s } = await seeded();
    const res = await s.member.get(base(s.list.id)).query({ status: 'WATCHING' });
    expect(names(res.body)).toEqual(['Dark']);
    expect(res.body.total).toBe(1);
  });

  it('filtra por tipo', async () => {
    const { s } = await seeded();
    const movies = await s.member.get(base(s.list.id)).query({ mediaType: 'MOVIE' });
    const tv = await s.member.get(base(s.list.id)).query({ mediaType: 'TV' });
    expect(names(movies.body)).toEqual(['Alien', 'Duna']);
    expect(names(tv.body)).toEqual(['Dark']);
  });

  it('filtra por gênero', async () => {
    const { s } = await seeded();
    const scifi = await s.member.get(base(s.list.id)).query({ genreId: 878 });
    const horror = await s.member.get(base(s.list.id)).query({ genreId: 27 });
    const none = await s.member.get(base(s.list.id)).query({ genreId: 99 });
    expect(names(scifi.body)).toEqual(['Alien', 'Duna']);
    expect(names(horror.body)).toEqual(['Alien']);
    expect(none.body).toMatchObject({ data: [], total: 0 });
  });

  it('combina filtros', async () => {
    const { s } = await seeded();
    const res = await s.member
      .get(base(s.list.id))
      .query({ mediaType: 'MOVIE', genreId: 878, status: 'WANT' });
    expect(names(res.body)).toEqual(['Duna']);
  });

  it('pagina com total coerente', async () => {
    const { s } = await seeded();
    const first = await s.member.get(base(s.list.id)).query({ pageSize: 2 });
    const second = await s.member.get(base(s.list.id)).query({ pageSize: 2, page: 2 });
    expect(names(first.body)).toEqual(['Alien', 'Dark']);
    expect(names(second.body)).toEqual(['Duna']);
    expect(first.body).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(second.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
  });

  it.each([
    [{ status: 'DONE' }],
    [{ mediaType: 'BOOK' }],
    [{ genreId: 'x' }],
    [{ genreId: 0 }],
    [{ sort: 'name:asc' }],
    [{ pageSize: 101 }],
    [{ page: 0 }],
  ])('400 VALIDATION_FAILED: %j', async (query) => {
    const s = await listScenario();
    const res = await s.member.get(base(s.list.id)).query(query);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('mostra addedBy nulo quando quem adicionou excluiu a conta', async () => {
    const s = await listScenario();
    const gone = await createUser();
    await createMembership(s.list, { user: gone, role: 'EDITOR' });
    await createListItem(s.list, { addedById: gone.id });
    await prisma.user.delete({ where: { id: gone.id } });

    const res = await s.member.get(base(s.list.id));
    expect(res.body.data[0].addedBy).toBeNull();
  });
});

describe('GET /lists/:listId/items/:itemId', () => {
  it('membro lê o item; não membro 404 LIST_NOT_FOUND; item de outra lista 404 ITEM_NOT_FOUND', async () => {
    const s = await listScenario();
    const item = await createListItem(s.list);
    const other = await createList({ owner: s.owner.user });
    const foreign = await createListItem(other);

    const ok = await s.member.get(`${base(s.list.id)}/${item.id}`);
    expect(ok.status).toBe(200);
    expect(ok.body.id).toBe(item.id);

    const outsider = await s.outsider.get(`${base(s.list.id)}/${item.id}`);
    expect(outsider.body).toMatchObject({ code: 'LIST_NOT_FOUND' });

    // O dono participa das duas listas, mas o item pertence à outra: o recurso filho é filtrado pelo listId autorizado.
    const crossed = await s.owner.get(`${base(s.list.id)}/${foreign.id}`);
    expect(crossed.status).toBe(404);
    expect(crossed.body).toMatchObject({ code: 'ITEM_NOT_FOUND' });

    const missing = await s.owner.get(`${base(s.list.id)}/${randomUUID()}`);
    expect(missing.body).toMatchObject({ code: 'ITEM_NOT_FOUND' });
    const malformed = await s.owner.get(`${base(s.list.id)}/nao-e-uuid`);
    expect(malformed.status).toBe(400);
  });
});

describe('status do item (CAP-15)', () => {
  it.each([
    ['put', (list: string, item: string) => `${base(list)}/${item}/status`],
    ['patch', (list: string, item: string) => `${base(list)}/${item}`],
  ] as const)(
    '%s: todo papel de membro altera; a última escrita prevalece',
    async (method, url) => {
      const s = await listScenario();
      const item = await createListItem(s.list);
      const path = url(s.list.id, item.id);

      const member = await s.member[method](path).send({ status: 'WATCHING' });
      expect(member.status).toBe(200);
      expect(member.body).toMatchObject({ id: item.id, status: 'WATCHING' });

      const editor = await s.editor[method](path).send({ status: 'WATCHED' });
      const owner = await s.owner[method](path).send({ status: 'WANT' });
      expect(editor.body.status).toBe('WATCHED');
      expect(owner.body.status).toBe('WANT');
      expect((await prisma.listItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(
        'WANT',
      );
    },
  );

  it.each(['put', 'patch'] as const)('%s: não membro → 404 LIST_NOT_FOUND', async (method) => {
    const s = await listScenario();
    const item = await createListItem(s.list);
    const path =
      method === 'put' ? `${base(s.list.id)}/${item.id}/status` : `${base(s.list.id)}/${item.id}`;
    const res = await s.outsider[method](path).send({ status: 'WATCHED' });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
    expect((await prisma.listItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe(
      'WANT',
    );
  });

  it('item de outra lista → 404 ITEM_NOT_FOUND e nada muda', async () => {
    const s = await listScenario();
    const other = await createList({ owner: s.owner.user });
    const foreign = await createListItem(other);

    const res = await s.owner
      .put(`${base(s.list.id)}/${foreign.id}/status`)
      .send({ status: 'WATCHED' });
    const patch = await s.owner
      .patch(`${base(s.list.id)}/${foreign.id}`)
      .send({ status: 'WATCHED' });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'ITEM_NOT_FOUND' });
    expect(patch.body).toMatchObject({ code: 'ITEM_NOT_FOUND' });
    expect((await prisma.listItem.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe(
      'WANT',
    );
  });

  it.each([{}, { status: 'DONE' }, { status: 'want' }, { status: 1 }])(
    '400 VALIDATION_FAILED: %j',
    async (body) => {
      const s = await listScenario();
      const item = await createListItem(s.list);
      const res = await s.member.put(`${base(s.list.id)}/${item.id}/status`).send(body);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    },
  );
});

describe('DELETE /lists/:listId/items/:itemId (CAP-13)', () => {
  it('dono e editor removem qualquer item (de qualquer autor); o Title global permanece', async () => {
    const s = await listScenario();
    const a = await createListItem(s.list, { addedById: s.member.user.id });
    const b = await createListItem(s.list, { addedById: s.owner.user.id });

    const byEditor = await s.editor.delete(`${base(s.list.id)}/${a.id}`);
    const byOwner = await s.owner.delete(`${base(s.list.id)}/${b.id}`);

    expect(byEditor.status).toBe(204);
    expect(byOwner.status).toBe(204);
    expect(await prisma.listItem.count()).toBe(0);
    expect(await prisma.title.count()).toBe(2);
  });

  it('membro comum → 403 INSUFFICIENT_ROLE; não membro → 404 LIST_NOT_FOUND', async () => {
    const s = await listScenario();
    const item = await createListItem(s.list);

    const member = await s.member.delete(`${base(s.list.id)}/${item.id}`);
    const outsider = await s.outsider.delete(`${base(s.list.id)}/${item.id}`);

    expect(member.status).toBe(403);
    expect(member.body).toMatchObject({ code: 'INSUFFICIENT_ROLE' });
    expect(outsider.status).toBe(404);
    expect(outsider.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
    expect(await prisma.listItem.count()).toBe(1);
  });

  it('item de outra lista (mesmo dono nas duas) → 404 ITEM_NOT_FOUND e nada é apagado', async () => {
    const s = await listScenario();
    const other = await createList({ owner: s.owner.user });
    const foreign = await createListItem(other);

    const res = await s.owner.delete(`${base(s.list.id)}/${foreign.id}`);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'ITEM_NOT_FOUND' });
    expect(await prisma.listItem.count()).toBe(1);
  });

  it('remover e adicionar de novo funciona', async () => {
    fakeTmdb.add(movieDetail());
    const s = await listScenario();
    const body = { mediaType: 'MOVIE', tmdbId: 438631 };
    const created = await s.owner.post(base(s.list.id)).send(body).expect(201);
    await s.owner.delete(`${base(s.list.id)}/${created.body.id}`).expect(204);
    await s.owner.post(base(s.list.id)).send(body).expect(201);
  });
});

describe('cascatas', () => {
  it('excluir a lista apaga os itens e preserva o Title', async () => {
    const s = await listScenario();
    await createListItem(s.list);
    await createListItem(s.list);

    await s.owner.delete(`/api/v1/lists/${s.list.id}`).expect(204);

    expect(await prisma.listItem.count()).toBe(0);
    expect(await prisma.title.count()).toBe(2);
  });

  it('excluir a conta de quem adicionou mantém o item com addedById nulo', async () => {
    const s = await listScenario();
    const item = await createListItem(s.list, { addedById: s.editor.user.id });

    await prisma.user.delete({ where: { id: s.editor.user.id } });

    const row = await prisma.listItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(row.addedById).toBeNull();
  });

  it('GET /lists devolve o itemCount real', async () => {
    const s = await listScenario();
    await createListItem(s.list);
    await createListItem(s.list);
    const empty = await createList({ owner: s.owner.user });

    const res = await s.owner.get('/api/v1/lists');
    const counts = Object.fromEntries(
      res.body.data.map((list: { id: string; itemCount: number }) => [list.id, list.itemCount]),
    );
    expect(counts[s.list.id]).toBe(2);
    expect(counts[empty.id]).toBe(0);
  });
});

describe('média e contagem de notas no ListItem (CAP-16)', () => {
  it('lista, detalhe e status refletem criação, edição e remoção de notas', async () => {
    const s = await listScenario();
    const rated = await createListItem(s.list, { addedAt: new Date('2026-01-02') });
    const bare = await createListItem(s.list, { addedAt: new Date('2026-01-01') });
    const url = `${base(s.list.id)}/${rated.id}`;

    await s.owner.put(`${url}/ratings/me`).send({ stars: 5 });
    await s.member.put(`${url}/ratings/me`).send({ stars: 2 });
    await s.editor.put(`${url}/ratings/me`).send({ stars: 4 });

    const page = await s.member.get(base(s.list.id));
    expect(page.body.data[0]).toMatchObject({ id: rated.id, ratingAverage: 3.67, ratingCount: 3 });
    expect(page.body.data[1]).toMatchObject({ id: bare.id, ratingAverage: null, ratingCount: 0 });

    await s.member.put(`${url}/ratings/me`).send({ stars: 5 });
    const detail = await s.member.get(url);
    expect(detail.body).toMatchObject({ ratingAverage: 4.67, ratingCount: 3 });

    await s.owner.delete(`${url}/ratings/me`);
    const status = await s.member.put(`${url}/status`).send({ status: 'WATCHED' });
    expect(status.body).toMatchObject({ ratingAverage: 4.5, ratingCount: 2 });

    await createRating(bare, { id: s.ids.owner }, 1);
    const after = await s.member.get(base(s.list.id));
    expect(after.body.data[1]).toMatchObject({ ratingAverage: 1, ratingCount: 1 });
  });
});
