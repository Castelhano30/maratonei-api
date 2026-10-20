import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { testApp } from '../../../test/helpers/app.js';
import { allowedOrigin } from '../../../test/helpers/as-user.js';
import { listScenario } from '../../../test/helpers/list-scenario.js';
import { createListItem } from '../../../test/factories/item.js';
import { createList } from '../../../test/factories/list.js';
import { createRating } from '../../../test/factories/rating.js';

const random = (listId: string) => `/api/v1/lists/${listId}/items/random`;

describe('GET /lists/:listId/items/random (CAP-20)', () => {
  it('sem sessão → 401', async () => {
    const res = await request(testApp()).get(random(randomUUID())).set('Origin', allowedOrigin());
    expect(res.status).toBe(401);
  });

  it('sorteia só entre os WANT e devolve um ListItem completo', async () => {
    const s = await listScenario();
    const want = await createListItem(s.list, { status: 'WANT' });
    await createListItem(s.list, { status: 'WATCHING' });
    await createListItem(s.list, { status: 'WATCHED' });
    await createRating(want, { id: s.ids.member }, 4);

    for (const client of [s.owner, s.editor, s.member]) {
      const res = await client.get(random(s.list.id));
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: want.id,
        status: 'WANT',
        ratingAverage: 4,
        ratingCount: 1,
        title: { tmdbId: want.title.tmdbId },
      });
    }
  });

  it('com vários pendentes, todos podem sair e nenhum de fora da lista', async () => {
    const s = await listScenario();
    const mine = await Promise.all([1, 2, 3].map(() => createListItem(s.list)));
    await createListItem(await createList());

    const seen = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      const res = await s.member.get(random(s.list.id));
      seen.add(res.body.data.id);
    }
    expect([...seen].sort()).toEqual(mine.map((item) => item.id).sort());
  });

  it('filtra por mediaType', async () => {
    const s = await listScenario();
    await createListItem(s.list, { titleInput: { mediaType: 'MOVIE' } });
    const tv = await createListItem(s.list, { titleInput: { mediaType: 'TV' } });

    for (let i = 0; i < 5; i += 1) {
      const res = await s.member.get(random(s.list.id)).query({ mediaType: 'TV' });
      expect(res.body.data.id).toBe(tv.id);
    }
  });

  it('sem pendentes (ou do tipo) → 200 {data: null}', async () => {
    const s = await listScenario();
    await createListItem(s.list, { status: 'WATCHED' });
    await createListItem(s.list, { titleInput: { mediaType: 'MOVIE' } });

    const some = await s.member.get(random(s.list.id));
    expect(some.status).toBe(200);
    expect(some.body.data).not.toBeNull();
    const noTv = await s.member.get(random(s.list.id)).query({ mediaType: 'TV' });
    expect(noTv.status).toBe(200);
    expect(noTv.body).toEqual({ data: null });
  });

  it('mediaType inválido → 400; não membro → 404 LIST_NOT_FOUND', async () => {
    const s = await listScenario();
    const invalid = await s.member.get(random(s.list.id)).query({ mediaType: 'SERIE' });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    const outsider = await s.outsider.get(random(s.list.id));
    expect(outsider.status).toBe(404);
    expect(outsider.body).toMatchObject({ code: 'LIST_NOT_FOUND' });
  });
});
