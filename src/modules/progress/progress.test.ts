import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { testApp } from '../../../test/helpers/app.js';
import { allowedOrigin } from '../../../test/helpers/as-user.js';
import { listScenario } from '../../../test/helpers/list-scenario.js';
import { createListItem } from '../../../test/factories/item.js';
import { createList } from '../../../test/factories/list.js';
import { createEpisodeProgress } from '../../../test/factories/progress.js';

const base = (listId: string, itemId: string) => `/api/v1/lists/${listId}/items/${itemId}/progress`;
const episode = (listId: string, itemId: string, season: number | string, ep: number | string) =>
  `${base(listId, itemId)}/me/episodes/${season}/${ep}`;

const SEASONS = [
  { season: 1, episodeCount: 10 },
  { season: 2, episodeCount: 8 },
];

async function seriesItem(list: { id: string }, withSeasons = true) {
  return createListItem(list, {
    titleInput: { mediaType: 'TV', ...(withSeasons ? { seasons: SEASONS } : {}) },
  });
}

describe('sem sessão (401 UNAUTHENTICATED)', () => {
  const id = randomUUID();
  it.each([
    ['get', base(id, id)],
    ['put', episode(id, id, 1, 1)],
    ['delete', episode(id, id, 1, 1)],
  ] as const)('%s %s', async (method, path) => {
    const res = await request(testApp())[method](path).set('Origin', allowedOrigin());
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('PUT /progress/me/episodes/:season/:episode (CAP-18)', () => {
  it('dono, editor e membro marcam o próprio progresso; repetir é idempotente', async () => {
    const s = await listScenario();
    const item = await seriesItem(s.list);

    for (const client of [s.owner, s.editor, s.member]) {
      const res = await client.put(episode(s.list.id, item.id, 1, 3));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ season: 1, episode: 3 });
    }
    const first = await s.member.put(episode(s.list.id, item.id, 2, 1));
    const again = await s.member.put(episode(s.list.id, item.id, 2, 1));
    expect(again.status).toBe(200);
    expect(again.body.watchedAt).toBe(first.body.watchedAt);
    expect(await prisma.episodeProgress.count({ where: { listItemId: item.id } })).toBe(4);
  });

  it('não altera o status coletivo do item', async () => {
    const s = await listScenario();
    const item = await seriesItem(s.list);
    await s.member.put(episode(s.list.id, item.id, 1, 1)).expect(200);
    const row = await prisma.listItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(row.status).toBe('WANT');
  });

  it.each([
    [3, 1],
    [1, 11],
    [2, 9],
  ])('S%sE%s inexistente na série → 400 VALIDATION_FAILED', async (season, ep) => {
    const s = await listScenario();
    const item = await seriesItem(s.list);
    const res = await s.member.put(episode(s.list.id, item.id, season, ep));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(res.body.errors).toHaveLength(1);
    expect(await prisma.episodeProgress.count()).toBe(0);
  });

  it.each([
    ['0', '1'],
    ['1', '0'],
    ['-1', '1'],
    ['1.5', '1'],
    ['abc', '1'],
  ])('%s/%s → 400 VALIDATION_FAILED', async (season, ep) => {
    const s = await listScenario();
    const item = await seriesItem(s.list);
    const res = await s.member.put(episode(s.list.id, item.id, season, ep));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('sem seasons conhecido, aceita inteiros positivos', async () => {
    const s = await listScenario();
    const item = await seriesItem(s.list, false);
    const res = await s.member.put(episode(s.list.id, item.id, 7, 42));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ season: 7, episode: 42 });
  });

  it('seasons vazio (`[]`) é tratado como desconhecido', async () => {
    const s = await listScenario();
    const item = await createListItem(s.list, { titleInput: { mediaType: 'TV', seasons: [] } });
    const res = await s.member.put(episode(s.list.id, item.id, 3, 5));
    expect(res.status).toBe(200);
  });

  it.each([
    ['objeto em vez de lista', { season: 1 }],
    ['itens com tipos errados', [{ season: '1', episodeCount: 'dez' }]],
    ['itens sem episodeCount', [{ season: 1 }]],
  ])('seasons malformado (%s) é tratado como desconhecido', async (_name, bad) => {
    const s = await listScenario();
    const item = await seriesItem(s.list);
    await prisma.title.update({ where: { id: item.titleId }, data: { seasons: bad } });
    const res = await s.member.put(episode(s.list.id, item.id, 7, 42));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ season: 7, episode: 42 });
  });

  it('marcações simultâneas do mesmo episódio não falham (idempotência sob concorrência)', async () => {
    const s = await listScenario();
    const item = await seriesItem(s.list);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => s.member.put(episode(s.list.id, item.id, 1, 2))),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await prisma.episodeProgress.count({ where: { listItemId: item.id } })).toBe(1);
  });

  it('filme → 400 NOT_A_SERIES', async () => {
    const s = await listScenario();
    const movie = await createListItem(s.list, { titleInput: { mediaType: 'MOVIE' } });
    for (const res of [
      await s.member.put(episode(s.list.id, movie.id, 1, 1)),
      await s.member.get(base(s.list.id, movie.id)),
      await s.member.delete(episode(s.list.id, movie.id, 1, 1)),
    ]) {
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'NOT_A_SERIES' });
    }
    expect(await prisma.episodeProgress.count()).toBe(0);
  });

  it('não membro → 404 LIST_NOT_FOUND; item de outra lista → 404 ITEM_NOT_FOUND', async () => {
    const s = await listScenario();
    const item = await seriesItem(s.list);
    const outsider = await s.outsider.put(episode(s.list.id, item.id, 1, 1));
    expect(outsider.status).toBe(404);
    expect(outsider.body).toMatchObject({ code: 'LIST_NOT_FOUND' });

    const otherList = await createList({ owner: s.owner.user });
    const foreign = await seriesItem(otherList);
    const res = await s.owner.put(episode(s.list.id, foreign.id, 1, 1));
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'ITEM_NOT_FOUND' });
    const missing = await s.owner.put(episode(s.list.id, randomUUID(), 1, 1));
    expect(missing.body).toMatchObject({ code: 'ITEM_NOT_FOUND' });
  });
});

describe('DELETE /progress/me/episodes/:season/:episode (CAP-18)', () => {
  it('desmarca só o episódio do próprio membro; idempotente', async () => {
    const s = await listScenario();
    const item = await seriesItem(s.list);
    await createEpisodeProgress(item, { id: s.ids.member }, 1, 1);
    await createEpisodeProgress(item, { id: s.ids.editor }, 1, 1);

    expect((await s.member.delete(episode(s.list.id, item.id, 1, 1))).status).toBe(204);
    expect((await s.member.delete(episode(s.list.id, item.id, 1, 1))).status).toBe(204);
    const left = await prisma.episodeProgress.findMany();
    expect(left.map((row) => row.memberId)).toEqual([s.ids.editor]);
  });

  it('não membro → 404 LIST_NOT_FOUND', async () => {
    const s = await listScenario();
    const item = await seriesItem(s.list);
    const res = await s.outsider.delete(episode(s.list.id, item.id, 1, 1));
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
  });
});

describe('GET /progress (CAP-18)', () => {
  it('um registro por membro, inclusive sem progresso; o ponto atual é o maior marcado', async () => {
    const s = await listScenario();
    const item = await seriesItem(s.list);
    await createEpisodeProgress(item, { id: s.ids.member }, 2, 1);
    await createEpisodeProgress(item, { id: s.ids.member }, 1, 9);
    await createEpisodeProgress(item, { id: s.ids.member }, 1, 3);
    await createEpisodeProgress(item, { id: s.ids.editor }, 1, 3);

    const res = await s.owner.get(base(s.list.id, item.id));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data.map((p: { member: { id: string } }) => p.member.id)).toEqual([
      s.owner.user.id,
      s.editor.user.id,
      s.member.user.id,
    ]);
    const [owner, editor, member] = res.body.data;
    expect(owner).toMatchObject({ current: null, watchedCount: 0, episodes: [] });
    expect(editor).toMatchObject({ current: { season: 1, episode: 3 }, watchedCount: 1 });
    expect(member).toMatchObject({ current: { season: 2, episode: 1 }, watchedCount: 3 });
    const positions = member.episodes.map((e: { season: number; episode: number }) => [
      e.season,
      e.episode,
    ]);
    expect(positions).toEqual([
      [1, 3],
      [1, 9],
      [2, 1],
    ]);
    expect(member.episodes[0].watchedAt).toEqual(expect.any(String));
  });

  it('quando um membro marca S1E3, os outros continuam sem progresso', async () => {
    const s = await listScenario();
    const item = await seriesItem(s.list);
    await s.member.put(episode(s.list.id, item.id, 1, 3)).expect(200);
    const res = await s.editor.get(base(s.list.id, item.id));
    const byUser = new Map(
      res.body.data.map((p: { member: { id: string } }) => [p.member.id, p] as const),
    );
    expect(byUser.get(s.member.user.id)).toMatchObject({ current: { season: 1, episode: 3 } });
    expect(byUser.get(s.owner.user.id)).toMatchObject({ current: null, watchedCount: 0 });
    expect(byUser.get(s.editor.user.id)).toMatchObject({ current: null, watchedCount: 0 });
  });

  it('não membro → 404; item de outra lista → 404 ITEM_NOT_FOUND', async () => {
    const s = await listScenario();
    const item = await seriesItem(s.list);
    const outsider = await s.outsider.get(base(s.list.id, item.id));
    expect(outsider.status).toBe(404);
    expect(outsider.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
    const other = await seriesItem(await createList({ owner: s.owner.user }));
    const res = await s.owner.get(base(s.list.id, other.id));
    expect(res.body).toMatchObject({ code: 'ITEM_NOT_FOUND' });
  });
});

describe('cascatas', () => {
  it('membro removido ou que sai perde o progresso; o dos outros fica', async () => {
    const s = await listScenario();
    const item = await seriesItem(s.list);
    await createEpisodeProgress(item, { id: s.ids.member }, 1, 1);
    await createEpisodeProgress(item, { id: s.ids.editor }, 1, 1);

    await s.owner.delete(`/api/v1/lists/${s.list.id}/members/${s.ids.member}`).expect(204);
    const left = await prisma.episodeProgress.findMany();
    expect(left.map((row) => row.memberId)).toEqual([s.ids.editor]);

    await s.editor.delete(`/api/v1/lists/${s.list.id}/members/me`).expect(204);
    expect(await prisma.episodeProgress.count()).toBe(0);
  });

  it('remover o item ou excluir a lista apaga o progresso', async () => {
    const s = await listScenario();
    const a = await seriesItem(s.list);
    const b = await seriesItem(s.list);
    await createEpisodeProgress(a, { id: s.ids.member }, 1, 1);
    await createEpisodeProgress(b, { id: s.ids.member }, 1, 1);

    await s.owner.delete(`/api/v1/lists/${s.list.id}/items/${a.id}`).expect(204);
    expect(await prisma.episodeProgress.count()).toBe(1);
    await s.owner.delete(`/api/v1/lists/${s.list.id}`).expect(204);
    expect(await prisma.episodeProgress.count()).toBe(0);
  });
});
