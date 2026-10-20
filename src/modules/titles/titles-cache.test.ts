import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../http/app-error.js';
import { setTmdbClient, type TmdbClient } from '../../lib/tmdb/index.js';
import { fakeTmdb } from '../../../test/helpers/tmdb.js';
import { providersDetail, seasonDetail, tvDetail } from '../../../test/fakes/tmdb-client.js';
import {
  NEGATIVE_TTL_MS,
  RECOMMENDATIONS_MEMORY_TTL_MS,
  getTitleRecommendations,
  getProviders,
  getSeason,
  getTitleDetail,
} from './titles.service.js';

/** Cliente que demora para responder, para que as chamadas se sobreponham. */
function slowClient(delayMs = 30): TmdbClient {
  const wait = () => new Promise((resolve) => setTimeout(resolve, delayMs));
  return {
    getPopularMovies: async () => (await wait(), fakeTmdb.getPopularMovies()),
    search: async (...args) => (await wait(), fakeTmdb.search(...args)),
    getTitle: async (...args) => (await wait(), fakeTmdb.getTitle(...args)),
    getSeason: async (...args) => (await wait(), fakeTmdb.getSeason(...args)),
    getProviders: async (...args) => (await wait(), fakeTmdb.getProviders(...args)),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('deduplicação de chamadas ao TMDB', () => {
  it('indicações deduplicam pedidos, expiram em 1 hora e não guardam falhas', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    setTmdbClient(slowClient());
    await Promise.all(Array.from({ length: 8 }, () => getTitleRecommendations()));
    expect(fakeTmdb.popularCalls).toHaveLength(1);
    vi.setSystemTime(Date.now() + RECOMMENDATIONS_MEMORY_TTL_MS - 1);
    await getTitleRecommendations();
    expect(fakeTmdb.popularCalls).toHaveLength(1);
    vi.setSystemTime(Date.now() + 2);
    fakeTmdb.setDown(true);
    await expect(getTitleRecommendations()).rejects.toMatchObject({ code: 'TMDB_UNAVAILABLE' });
    fakeTmdb.setDown(false);
    await getTitleRecommendations();
    expect(fakeTmdb.popularCalls).toHaveLength(3);
  });
  it('temporada: N pedidos simultâneos geram 1 chamada', async () => {
    fakeTmdb.addSeason(70523, seasonDetail(1, 3));
    setTmdbClient(slowClient());

    const results = await Promise.all(Array.from({ length: 8 }, () => getSeason(70523, 1)));

    expect(fakeTmdb.getSeasonCalls).toHaveLength(1);
    expect(new Set(results).size).toBe(1);
  });

  it('providers e detalhe também compartilham a promessa em andamento', async () => {
    fakeTmdb.add(tvDetail()).addProviders('TV', 70523, providersDetail());
    setTmdbClient(slowClient());

    await Promise.all([
      ...Array.from({ length: 5 }, () => getProviders('TV', 70523)),
      ...Array.from({ length: 5 }, () => getTitleDetail('TV', 70523)),
    ]);

    expect(fakeTmdb.getProvidersCalls).toHaveLength(1);
    expect(fakeTmdb.getTitleCalls).toHaveLength(1);
  });

  it('chaves diferentes não se misturam', async () => {
    fakeTmdb.addSeason(70523, seasonDetail(1)).addSeason(70523, seasonDetail(2));
    setTmdbClient(slowClient());

    await Promise.all([getSeason(70523, 1), getSeason(70523, 2)]);

    expect(fakeTmdb.getSeasonCalls).toHaveLength(2);
  });
});

describe('falha e cache negativo', () => {
  it('falha do TMDB (503) não fica cacheada: a próxima tentativa chama de novo', async () => {
    fakeTmdb.addSeason(70523, seasonDetail(1));
    fakeTmdb.setDown(true);
    await expect(getSeason(70523, 1)).rejects.toMatchObject({ code: 'TMDB_UNAVAILABLE' });

    fakeTmdb.setDown(false);
    await expect(getSeason(70523, 1)).resolves.toMatchObject({ season: 1 });
    expect(fakeTmdb.getSeasonCalls).toHaveLength(2);
  });

  it('falhas simultâneas compartilham o erro, mas a seguinte tenta de novo', async () => {
    fakeTmdb.addSeason(70523, seasonDetail(1));
    fakeTmdb.setDown(true);
    const settled = await Promise.allSettled([getSeason(70523, 1), getSeason(70523, 1)]);
    expect(settled.map((r) => r.status)).toEqual(['rejected', 'rejected']);

    fakeTmdb.setDown(false);
    await expect(getSeason(70523, 1)).resolves.toBeDefined();
  });

  it('404 fica em cache por 5 min e depois consulta de novo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await expect(getSeason(70523, 9)).rejects.toMatchObject({ code: 'TITLE_NOT_FOUND' });
    await expect(getSeason(70523, 9)).rejects.toBeInstanceOf(AppError);
    expect(fakeTmdb.getSeasonCalls).toHaveLength(1);

    vi.setSystemTime(Date.now() + NEGATIVE_TTL_MS + 1000);
    fakeTmdb.addSeason(70523, seasonDetail(9, 2));
    await expect(getSeason(70523, 9)).resolves.toMatchObject({ season: 9 });
    expect(fakeTmdb.getSeasonCalls).toHaveLength(2);
  });
});
