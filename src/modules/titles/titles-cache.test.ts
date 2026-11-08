import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DETAIL_TTL_MS,
  PROVIDERS_TTL_MS,
  SEARCH_TTL_MS,
  STALE_RETENTION_MS,
} from '../../lib/cache/index.js';
import { testApp } from '../../../test/helpers/app.js';
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
    ...fakeTmdb,
    getPopularMovies: async () => (await wait(), fakeTmdb.getPopularMovies()),
    search: async (...args) => (await wait(), fakeTmdb.search(...args)),
    searchByType: async (...args) => (await wait(), fakeTmdb.searchByType(...args)),
    getTitle: async (...args) => (await wait(), fakeTmdb.getTitle(...args)),
    getSeason: async (...args) => (await wait(), fakeTmdb.getSeason(...args)),
    getProviders: async (...args) => (await wait(), fakeTmdb.getProviders(...args)),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const publicCases = [
  { path: '/api/v1/titles/search?q=dark', ttl: SEARCH_TTL_MS, calls: () => fakeTmdb.searchCalls },
  {
    path: '/api/v1/titles/search?q=dark&mediaType=TV',
    ttl: SEARCH_TTL_MS,
    calls: () => fakeTmdb.searchByTypeCalls,
  },
  { path: '/api/v1/titles/TV/70523', ttl: DETAIL_TTL_MS, calls: () => fakeTmdb.getTitleCalls },
  {
    path: '/api/v1/titles/TV/70523/providers',
    ttl: PROVIDERS_TTL_MS,
    calls: () => fakeTmdb.getProvidersCalls,
  },
];

describe.each(publicCases)('cache público na rota $path', ({ path, ttl, calls }) => {
  it('reutiliza dentro do TTL e consulta novamente depois', async () => {
    fakeTmdb.add(tvDetail()).addProviders('TV', 70523, providersDetail());
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now);
    const first = await request(testApp()).get(path).expect(200);
    spy.mockReturnValue(now + ttl - 1);
    const cached = await request(testApp()).get(path).expect(200);
    expect(cached.body).toEqual(first.body);
    expect(calls()).toHaveLength(1);
    spy.mockReturnValue(now + ttl + 1);
    await request(testApp()).get(path).expect(200);
    expect(calls()).toHaveLength(2);
  });

  it('serve cópia vencida na queda, sem renovar sua idade, até TTL + 24 h', async () => {
    fakeTmdb.add(tvDetail()).addProviders('TV', 70523, providersDetail());
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now);
    const first = await request(testApp()).get(path).expect(200);
    fakeTmdb.setDown(true);
    spy.mockReturnValue(now + ttl + 1);
    const stale = await request(testApp()).get(path).expect(200);
    expect(stale.body).toEqual(first.body);
    expect(calls()).toHaveLength(2);
    spy.mockReturnValue(now + ttl + STALE_RETENTION_MS - 1);
    const last = await request(testApp()).get(path).expect(200);
    expect(last.body).toEqual(first.body);
    spy.mockReturnValue(now + ttl + STALE_RETENTION_MS + 1);
    const expired = await request(testApp()).get(path).expect(503);
    expect(expired.body.code).toBe('TMDB_UNAVAILABLE');
  });

  it('sem cópia, falha não fica cacheada', async () => {
    fakeTmdb.setDown(true);
    const failed = await request(testApp()).get(path).expect(503);
    expect(failed.body.code).toBe('TMDB_UNAVAILABLE');
    fakeTmdb.setDown(false);
    fakeTmdb.add(tvDetail());
    await request(testApp()).get(path).expect(200);
    expect(calls()).toHaveLength(2);
  });

  it('oito pedidos simultâneos geram uma chamada ao TMDB', async () => {
    fakeTmdb.add(tvDetail());
    setTmdbClient(slowClient());
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => request(testApp()).get(path).expect(200)),
    );
    for (const response of responses) expect(response.body).toEqual(responses[0]?.body);
    expect(calls()).toHaveLength(1);
  });
});

describe('chaves e cache negativo nas rotas públicas', () => {
  it('normaliza a busca e separa texto, página e tipo', async () => {
    fakeTmdb.add(tvDetail({ name: 'Dark Movie' }));
    const get = (q: string, page = 1, mediaType?: string) =>
      request(testApp()).get('/api/v1/titles/search').query({ q, page, mediaType }).expect(200);
    const first = await get('  DARK   Movie  ');
    const normalized = await get('dark movie');
    expect(normalized.body).toEqual(first.body);
    expect(fakeTmdb.searchCalls).toEqual([{ query: 'dark movie', page: 1 }]);
    await get('dark');
    await get('dark movie', 2);
    await get('dark movie', 1, 'MOVIE');
    await get('dark movie', 1, 'TV');
    expect(fakeTmdb.searchCalls).toHaveLength(3);
    expect(fakeTmdb.searchByTypeCalls).toEqual([
      { mediaType: 'MOVIE', query: 'dark movie', page: 1 },
      { mediaType: 'TV', query: 'dark movie', page: 1 },
    ]);
  });

  it.each([
    { path: '/api/v1/titles/TV/70523', calls: () => fakeTmdb.getTitleCalls },
    { path: '/api/v1/titles/TV/70523/providers', calls: () => fakeTmdb.getProvidersCalls },
  ])('404 em $path fica 5 min em cache', async ({ path, calls }) => {
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now);
    const missing = await request(testApp()).get(path).expect(404);
    expect(missing.body.code).toBe('TITLE_NOT_FOUND');
    fakeTmdb.add(tvDetail());
    spy.mockReturnValue(now + NEGATIVE_TTL_MS - 1);
    await request(testApp()).get(path).expect(404);
    expect(calls()).toHaveLength(1);
    spy.mockReturnValue(now + NEGATIVE_TTL_MS + 1);
    await request(testApp()).get(path).expect(200);
    expect(calls()).toHaveLength(2);
  });
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
