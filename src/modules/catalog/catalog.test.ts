import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { config } from '../../config.js';
import { AppError } from '../../http/app-error.js';
import type { Page } from '../../http/pagination.js';
import { PUBLIC_CACHE_CONTROL } from '../../http/public.js';
import { CATALOG_TTL_MS, GENRES_TTL_MS, STALE_RETENTION_MS } from '../../lib/cache/index.js';
import { prisma } from '../../lib/prisma.js';
import { setTmdbClient, type TmdbMediaType } from '../../lib/tmdb/index.js';
import type { CatalogCard } from '../../openapi/common.js';
import { testApp } from '../../../test/helpers/app.js';
import { fakeTmdb } from '../../../test/helpers/tmdb.js';
import {
  catalogItem,
  catalogItems,
  movieDetail,
  providersDetail,
  tvDetail,
} from '../../../test/fakes/tmdb-client.js';

const BASE = '/api/v1/catalog';
const TYPES = ['MOVIE', 'TV'] as const;
const get = (path: string) => request(testApp()).get(`${BASE}/${path}`);
const cards = (body: unknown) => (body as Page<CatalogCard>).data;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('contrato público do catálogo', () => {
  it.each(TYPES)('aceita ALL, STREAMING e TOP_RATED em %s sem sessão', async (mediaType) => {
    for (const collection of ['ALL', 'STREAMING', 'TOP_RATED']) {
      const res = await get(`${mediaType}?collection=${collection}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [], total: 0, page: 1, pageSize: 20 });
      expect(res.headers['cache-control']).toBe(PUBLIC_CACHE_CONTROL);
    }
  });

  it.each(['TV?collection=NOW_PLAYING', 'MOVIE?collection=RECENT'])(
    'rejeita combinação %s',
    async (path) => {
      const res = await get(path);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'collection', message: expect.any(String) }],
      });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(fakeTmdb.callCount()).toBe(0);
    },
  );

  it.each([
    'MOVIE?page=0',
    'MOVIE?page=501',
    'MOVIE?page=1.5',
    'MOVIE?genreId=0',
    'MOVIE?genreId=1.5',
    'MOVIE?sort=XYZ',
    'MOVIE?collection=XYZ',
    'ANIME',
    'genres',
    'genres?mediaType=ANIME',
  ])('valida %s', async (path) => {
    const res = await get(path);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(fakeTmdb.callCount()).toBe(0);
  });

  it('pagina 45 itens com tamanho fixo e aceita a página 500', async () => {
    const items = catalogItems('MOVIE', 45);
    fakeTmdb.addCatalogItems(...items);
    const first = await get('MOVIE?pageSize=1');
    const second = await get('MOVIE?page=2');
    const third = await get('MOVIE?page=3');
    expect(first.body).toMatchObject({ total: 45, page: 1, pageSize: 20 });
    expect(cards(first.body).map((c) => c.tmdbId)).toEqual(items.slice(0, 20).map((c) => c.tmdbId));
    expect(second.body).toMatchObject({ total: 45, page: 2, pageSize: 20 });
    expect(cards(second.body).map((c) => c.tmdbId)).toEqual(
      items.slice(20, 40).map((c) => c.tmdbId),
    );
    expect(cards(third.body)).toHaveLength(5);
    expect((await get('MOVIE?page=500')).status).toBe(200);
  });

  it('limita total às 500 páginas acessíveis', async () => {
    const discover = fakeTmdb.discover.bind(fakeTmdb);
    vi.spyOn(fakeTmdb, 'discover').mockImplementation(async (...args) => ({
      ...(await discover(...args)),
      totalResults: 25_000,
    }));
    expect((await get('MOVIE')).body.total).toBe(10_000);
  });

  it('lista gêneros em pt-BR por tipo e filtra a coleção', async () => {
    fakeTmdb.setGenres('MOVIE', [
      { id: 18, name: 'Drama' },
      { id: 28, name: 'Ação' },
    ]);
    fakeTmdb.setGenres('TV', [{ id: 9648, name: 'Mistério' }]);
    const drama = catalogItem({ genreIds: [18] });
    fakeTmdb.addCatalogItems(drama, catalogItem({ genreIds: [28] }));
    const genres = await get('genres?mediaType=MOVIE');
    expect(genres.status).toBe(200);
    expect(genres.body).toEqual({
      data: [
        { id: 18, name: 'Drama' },
        { id: 28, name: 'Ação' },
      ],
    });
    expect((await get('genres?mediaType=TV')).body).toEqual({
      data: [{ id: 9648, name: 'Mistério' }],
    });
    const filtered = await get('MOVIE?genreId=18');
    expect(cards(filtered.body).map((c) => c.tmdbId)).toEqual([drama.tmdbId]);
    expect(fakeTmdb.discoverCalls[0]?.params.with_genres).toBe('18');
  });

  it('aplica os guards nas duas rotas, antes do limitador global', async () => {
    const app = createApp({
      rateLimit: { global: { limit: 1, windowMs: 60_000 }, public: { limit: 2, windowMs: 60_000 } },
    });
    expect((await request(app).get(`${BASE}/MOVIE`)).status).toBe(200);
    expect((await request(app).get(`${BASE}/genres?mediaType=MOVIE`)).status).toBe(200);
    const limited = await request(app).get(`${BASE}/MOVIE`);
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    expect(limited.headers['cache-control']).toBe('no-store');
  });
});

describe('tradução de coleções e ordens para o TMDB', () => {
  it.each(TYPES)('ALL em %s respeita popularidade, lançamento e nota', async (mediaType) => {
    const items = [
      catalogItem({ mediaType, year: 2020, voteAverage: 8, voteCount: 5000 }),
      catalogItem({ mediaType, year: 2025, voteAverage: 7, voteCount: 6000 }),
      catalogItem({ mediaType, year: 2026, voteAverage: 9.9, voteCount: 5 }),
    ];
    fakeTmdb.addCatalogItems(...items);
    const popular = await get(mediaType);
    expect(cards(popular.body).map((c) => c.tmdbId)).toEqual(items.map((c) => c.tmdbId));
    expect(fakeTmdb.discoverCalls[0]?.params).toEqual({
      region: 'BR',
      page: '1',
      sort_by: 'popularity.desc',
    });
    const newest = await get(`${mediaType}?sort=NEWEST`);
    expect(cards(newest.body).map((c) => c.tmdbId)).toEqual([items[1]?.tmdbId, items[0]?.tmdbId]);
    expect(fakeTmdb.discoverCalls[1]?.params).toMatchObject({
      'vote_count.gte': '10',
      [`${mediaType === 'MOVIE' ? 'primary_release_date' : 'first_air_date'}.lte`]: new Date()
        .toISOString()
        .slice(0, 10),
    });
    const rated = await get(`${mediaType}?sort=VOTE_AVERAGE`);
    expect(cards(rated.body).map((c) => c.tmdbId)).toEqual([items[0]?.tmdbId, items[1]?.tmdbId]);
    expect(fakeTmdb.discoverCalls[2]?.params['vote_count.gte']).toBe(
      String(mediaType === 'MOVIE' ? config.CATALOG_MIN_VOTES_MOVIE : config.CATALOG_MIN_VOTES_TV),
    );
  });

  it.each(TYPES)('TOP_RATED em %s aplica o piso configurado e ignora sort', async (mediaType) => {
    const floor =
      mediaType === 'MOVIE' ? config.CATALOG_MIN_VOTES_MOVIE : config.CATALOG_MIN_VOTES_TV;
    const best = catalogItem({ mediaType, voteCount: floor, voteAverage: 9 });
    const next = catalogItem({ mediaType, voteCount: floor + 1, voteAverage: 8 });
    fakeTmdb.addCatalogItems(
      next,
      catalogItem({ mediaType, voteCount: 5, voteAverage: 9.9 }),
      best,
      catalogItem({ mediaType, voteCount: floor - 1, voteAverage: 9.5 }),
    );
    const res = await get(`${mediaType}?collection=TOP_RATED&sort=NEWEST`);
    expect(res.status).toBe(200);
    expect(cards(res.body).map((c) => c.tmdbId)).toEqual([best.tmdbId, next.tmdbId]);
    expect(fakeTmdb.discoverCalls[0]?.params).toEqual({
      region: 'BR',
      page: '1',
      sort_by: 'vote_average.desc',
      'vote_count.gte': String(floor),
    });
    await get(`${mediaType}?collection=TOP_RATED&sort=POPULARITY`);
    expect(fakeTmdb.discoverCalls).toHaveLength(1);
  });

  it('NOW_PLAYING usa a rota dedicada por padrão e a janela regional com gênero', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-10T01:00:00Z'));
    const item = catalogItem({
      overview: 'Uma longa sinopse para testar o corte entre palavras. '.repeat(8),
    });
    fakeTmdb.setNowPlaying([item]).addCatalogItems(item);
    const res = await get('MOVIE?collection=NOW_PLAYING');
    expect(res.status).toBe(200);
    expect(fakeTmdb.nowPlayingCalls).toEqual([1]);
    const overview = cards(res.body)[0]?.overview;
    expect(overview).toBe(
      `${item.overview.slice(0, 219).slice(0, item.overview.slice(0, 219).lastIndexOf(' '))}…`,
    );
    expect(overview?.length).toBeLessThanOrEqual(220);
    await get('MOVIE?collection=NOW_PLAYING&genreId=18');
    expect(fakeTmdb.discoverCalls[0]?.params).toEqual({
      region: 'BR',
      page: '1',
      sort_by: 'popularity.desc',
      with_genres: '18',
      'release_date.gte': '2025-11-26',
      'release_date.lte': '2026-01-10',
      with_release_type: '2|3',
    });
    for (const [sort, floor] of [
      ['NEWEST', '10'],
      ['VOTE_AVERAGE', '25'],
    ]) {
      await get(`MOVIE?collection=NOW_PLAYING&sort=${sort}`);
      expect(fakeTmdb.discoverCalls.at(-1)?.params['vote_count.gte']).toBe(floor);
    }
    expect(fakeTmdb.nowPlayingCalls).toHaveLength(1);
  });

  it.each(TYPES)(
    'STREAMING em %s envia provedores, região e data UTC e ordena NEWEST',
    async (mediaType) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-01-10T01:00:00Z'));
      const older = catalogItem({ mediaType, year: 2020 });
      const newer = catalogItem({ mediaType, year: 2025 });
      fakeTmdb.addCatalogItems(older, newer);
      const res = await get(`${mediaType}?collection=STREAMING&sort=NEWEST`);
      expect(cards(res.body).map((c) => c.tmdbId)).toEqual([newer.tmdbId, older.tmdbId]);
      const field = mediaType === 'MOVIE' ? 'primary_release_date' : 'first_air_date';
      expect(fakeTmdb.discoverCalls[0]).toEqual({
        mediaType,
        params: {
          page: '1',
          region: 'BR',
          sort_by: `${field}.desc`,
          'vote_count.gte': '10',
          [`${field}.lte`]: '2026-01-10',
          with_watch_providers: '8|119|337|1899|11',
          watch_region: 'BR',
          with_watch_monetization_types: 'flatrate',
        },
      });
      await get(`${mediaType}?collection=STREAMING&sort=VOTE_AVERAGE`);
      expect(fakeTmdb.discoverCalls[1]?.params['vote_count.gte']).toBe(
        String(
          mediaType === 'MOVIE' ? config.CATALOG_MIN_VOTES_MOVIE : config.CATALOG_MIN_VOTES_TV,
        ),
      );
    },
  );

  it('RECENT filtra estreias por first_air_date nos últimos 180 dias', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-10T01:00:00Z'));
    for (const [sort, sortBy, floor] of [
      ['POPULARITY', 'popularity.desc', undefined],
      ['NEWEST', 'first_air_date.desc', '10'],
      ['VOTE_AVERAGE', 'vote_average.desc', '25'],
    ]) {
      const res = await get(`TV?collection=RECENT&sort=${sort}`);
      expect(res.status).toBe(200);
      const params = fakeTmdb.discoverCalls.at(-1)?.params;
      expect(params).toEqual({
        region: 'BR',
        page: '1',
        sort_by: sortBy,
        'first_air_date.gte': '2025-07-14',
        'first_air_date.lte': '2026-01-10',
        ...(floor ? { 'vote_count.gte': floor } : {}),
      });
    }
  });
});

const ENRICHED = [
  ['MOVIE', 'STREAMING', 'provider'],
  ['TV', 'STREAMING', 'provider'],
  ['TV', 'RECENT', 'latestSeason'],
  ['MOVIE', 'TOP_RATED', 'originCountry'],
] as const;

function seedEnrichment(mediaType: TmdbMediaType) {
  const items = catalogItems(mediaType, 45, { voteCount: 10_000 });
  fakeTmdb.addCatalogItems(...items);
  for (const item of items) {
    fakeTmdb.add(
      mediaType === 'MOVIE'
        ? movieDetail({ tmdbId: item.tmdbId })
        : tvDetail({ tmdbId: item.tmdbId }),
    );
    fakeTmdb.addProviders(mediaType, item.tmdbId, providersDetail());
  }
  return items;
}

describe('cartões e enriquecimento limitado', () => {
  it.each(ENRICHED)(
    '%s %s enriquece só dez itens da página 1, reutiliza o cache e não grava Title (%s)',
    async (mediaType, collection, field) => {
      seedEnrichment(mediaType);
      const before = await prisma.title.count();
      const res = await get(`${mediaType}?collection=${collection}`);
      expect(res.status).toBe(200);
      const data = cards(res.body);
      expect(data.slice(0, 10).every((card) => card[field] !== null)).toBe(true);
      expect(data.slice(10).every((card) => card[field] === null)).toBe(true);
      if (field === 'latestSeason') expect(data[0]?.latestSeason).toBe(3);
      if (field === 'originCountry') expect(data[0]?.originCountry).toBe('US');
      expect(fakeTmdb.callCount()).toBe(11);
      const hot = await get(`${mediaType}?collection=${collection}`);
      expect(hot.body).toEqual(res.body);
      expect(fakeTmdb.callCount()).toBe(11);
      const next = await get(`${mediaType}?collection=${collection}&page=2`);
      expect(cards(next.body)).toHaveLength(20);
      expect(cards(next.body).every((card) => card[field] === null)).toBe(true);
      expect(fakeTmdb.callCount()).toBe(12);
      expect(await prisma.title.count()).toBe(before);
    },
  );

  it.each(ENRICHED)(
    '%s %s mantém 200 quando o enriquecimento de %s falha',
    async (mediaType, collection, field) => {
      seedEnrichment(mediaType);
      fakeTmdb.setDown(true, [field === 'provider' ? 'getProviders' : 'getTitle']);
      const res = await get(`${mediaType}?collection=${collection}`);
      expect(res.status).toBe(200);
      expect(cards(res.body).every((card) => card[field] === null)).toBe(true);
      expect(fakeTmdb.callCount()).toBe(11);
    },
  );

  it('enriquece em paralelo e preserva sucessos quando outro item falha', async () => {
    const items = seedEnrichment('TV');
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const providers = fakeTmdb.getProviders.bind(fakeTmdb);
    const spy = vi.spyOn(fakeTmdb, 'getProviders').mockImplementation(async (...args) => {
      await pending;
      if (args[1] === items[0]?.tmdbId) throw new Error('Falha de enriquecimento');
      return providers(...args);
    });
    const response = get('TV?collection=STREAMING').then((res) => res);
    try {
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(10));
    } finally {
      release();
    }
    const res = await response;
    expect(res.status).toBe(200);
    expect(cards(res.body)[0]?.provider).toBeNull();
    expect(cards(res.body)[1]?.provider?.providerId).toBe(8);
  });

  it('enriquecimento incompleto responde 200, mas a página não fica em cache', async () => {
    seedEnrichment('TV');
    const spy = vi.spyOn(fakeTmdb, 'getProviders').mockRejectedValue(new Error('falha'));
    const first = await get('TV?collection=STREAMING');
    expect(first.status).toBe(200);
    expect(cards(first.body).every((card) => card.provider === null)).toBe(true);

    spy.mockRestore();
    const second = await get('TV?collection=STREAMING');
    expect(second.status).toBe(200);
    expect(cards(second.body)[0]?.provider?.providerId).toBe(8);
  });

  it('seleciona o primeiro flatrate permitido e ignora aluguel e provedores externos', async () => {
    const items = catalogItems('MOVIE', 2);
    const outside = { providerId: 999, providerName: 'Outro', logoPath: null };
    const allowed = { providerId: 11, providerName: 'MUBI', logoPath: '/mubi.jpg' };
    fakeTmdb.addCatalogItems(...items);
    for (const [index, item] of items.entries())
      fakeTmdb.addProviders(
        'MOVIE',
        item.tmdbId,
        providersDetail({
          flatrate: index === 0 ? [outside, allowed, { ...allowed, providerId: 8 }] : [outside],
          rent: [allowed],
        }),
      );
    const res = await get('MOVIE?collection=STREAMING');
    expect(cards(res.body).map((c) => c.provider)).toEqual([allowed, null]);
  });

  it.each(TYPES)(
    'ALL e TOP_RATED de TV não enriquecem campos fora da coleção (%s)',
    async (mediaType) => {
      seedEnrichment(mediaType);
      const res = await get(mediaType);
      expect(
        cards(res.body).every(
          (c) =>
            c.provider === null &&
            c.latestSeason === null &&
            c.originCountry === (mediaType === 'TV' ? 'DE' : null),
        ),
      ).toBe(true);
      expect(fakeTmdb.callCount()).toBe(1);
      if (mediaType === 'TV') {
        await get('TV?collection=TOP_RATED');
        expect(fakeTmdb.getTitleCalls).toHaveLength(0);
      }
    },
  );

  it('publica campos nulos, nota arredondada e sinopse sem cortar além do limite', async () => {
    fakeTmdb.addCatalogItems(
      catalogItem({ overview: '   ', voteAverage: 0, voteCount: 0, year: null, posterPath: null }),
      catalogItem({ overview: 'x'.repeat(221), voteAverage: 8.76 }),
      catalogItem({ overview: 'x'.repeat(220), voteAverage: null }),
    );
    const res = await get('MOVIE');
    expect(cards(res.body)[0]).toMatchObject({
      overview: null,
      voteAverage: null,
      year: null,
      posterPath: null,
      provider: null,
      latestSeason: null,
      originCountry: null,
    });
    expect(cards(res.body)[1]).toMatchObject({ overview: `${'x'.repeat(219)}…`, voteAverage: 8.8 });
    expect(cards(res.body)[2]).toMatchObject({ overview: 'x'.repeat(220), voteAverage: null });
  });
});

describe('cache público e indisponibilidade', () => {
  const routes = [
    ['MOVIE', CATALOG_TTL_MS],
    ['genres?mediaType=MOVIE', GENRES_TTL_MS],
  ] as const;

  it.each(routes)('%s expira em seu TTL (%i ms)', async (path, ttl) => {
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    await get(path);
    clock.mockReturnValue(start + ttl - 1);
    await get(path);
    expect(fakeTmdb.callCount()).toBe(1);
    clock.mockReturnValue(start + ttl);
    expect((await get(path)).status).toBe(200);
    expect(fakeTmdb.callCount()).toBe(2);
  });

  it.each(routes)('%s serve cópia vencida só até TTL + 24h (%i ms)', async (path, ttl) => {
    fakeTmdb.addCatalogItems(catalogItem()).setGenres('MOVIE', [{ id: 18, name: 'Drama' }]);
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    const original = await get(path);
    fakeTmdb.setDown(true);
    clock.mockReturnValue(start + ttl);
    const stale = await get(path);
    expect(stale.status).toBe(200);
    expect(stale.body).toEqual(original.body);
    clock.mockReturnValue(start + ttl + STALE_RETENTION_MS - 1);
    expect((await get(path)).body).toEqual(original.body);
    clock.mockReturnValue(start + ttl + STALE_RETENTION_MS);
    const expired = await get(path);
    expect(expired.status).toBe(503);
    expect(expired.body.code).toBe('TMDB_UNAVAILABLE');
    expect(expired.headers['cache-control']).toBe('no-store');
  });

  it.each(routes)('%s sem cópia retorna 503 e não guarda falhas (%i ms)', async (path) => {
    fakeTmdb.setDown(true);
    const res = await get(path);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('TMDB_UNAVAILABLE');
    expect(res.headers['cache-control']).toBe('no-store');
    fakeTmdb.setDown(false);
    expect((await get(path)).status).toBe(200);
    expect(fakeTmdb.callCount()).toBe(2);
  });

  it.each(routes)('%s deduplica oito pedidos simultâneos (%i ms)', async (path) => {
    const delay = () => new Promise((resolve) => setTimeout(resolve, 50));
    setTmdbClient({
      ...fakeTmdb,
      discover: async (...args) => {
        await delay();
        return fakeTmdb.discover(...args);
      },
      listGenres: async (...args) => {
        await delay();
        return fakeTmdb.listGenres(...args);
      },
    });
    const results = await Promise.all(Array.from({ length: 8 }, () => get(path)));
    expect(results.every((res) => res.status === 200)).toBe(true);
    expect(fakeTmdb.callCount()).toBe(1);
  });

  it('separa todas as dimensões da chave de catálogo', async () => {
    for (const path of [
      'MOVIE',
      'TV',
      'MOVIE?genreId=18',
      'MOVIE?sort=NEWEST',
      'MOVIE?page=2',
      'MOVIE?collection=STREAMING',
    ]) {
      await get(path);
      await get(path);
    }
    expect(fakeTmdb.discoverCalls).toHaveLength(6);
  });
});

describe('404 do TMDB em listagem e sinopse', () => {
  it('404 do TMDB vira 503 TMDB_UNAVAILABLE no catálogo e nos gêneros, com no-store', async () => {
    const notFound = () => Promise.reject(new AppError('TITLE_NOT_FOUND'));
    vi.spyOn(fakeTmdb, 'discover').mockImplementation(notFound);
    vi.spyOn(fakeTmdb, 'listGenres').mockImplementation(notFound);
    for (const path of ['MOVIE?collection=ALL', 'genres?mediaType=MOVIE']) {
      const res = await get(path);
      expect(res.status, path).toBe(503);
      expect(res.body.code, path).toBe('TMDB_UNAVAILABLE');
      expect(res.headers['cache-control'], path).toBe('no-store');
    }
  });

  it('sinopse sem espaços não parte um par substituto ao truncar', async () => {
    fakeTmdb.addCatalogItems(catalogItem({ overview: '😀'.repeat(300) }));
    const res = await get('MOVIE?collection=ALL');
    const overview = cards(res.body)[0]?.overview ?? '';
    expect(overview.endsWith('…')).toBe(true);
    expect(Array.from(overview).length).toBeLessThanOrEqual(220);
    // Um surrogate solto viraria U+FFFD ao ser codificado em UTF-8.
    expect(Buffer.from(overview, 'utf8').toString('utf8')).toBe(overview);
  });
});

describe('OpenAPI do catálogo', () => {
  it('publica componentes nomeados, parâmetros e erros públicos sem 401', async () => {
    const res = await request(testApp()).get('/api/v1/openapi.json');
    const doc = res.body as {
      paths: Record<
        string,
        {
          get: {
            operationId: string;
            parameters: { name: string; required?: boolean }[];
            responses: Record<string, { content?: Record<string, { schema: { $ref: string } }> }>;
          };
        }
      >;
      components: { schemas: Record<string, { properties: Record<string, unknown> }> };
    };
    expect(res.status).toBe(200);
    for (const [path, id, schema] of [
      ['{mediaType}', 'listCatalog', 'CatalogPage'],
      ['genres', 'listCatalogGenres', 'GenreList'],
    ]) {
      const operation = doc.paths[`${BASE}/${path}`]?.get;
      expect(operation?.operationId).toBe(id);
      expect(Object.keys(operation?.responses ?? {}).sort()).toEqual(['200', '400', '429', '503']);
      expect(operation?.responses['200']?.content?.['application/json']?.schema.$ref).toBe(
        `#/components/schemas/${schema}`,
      );
      expect(operation?.parameters.some((p) => p.name === 'pageSize')).toBe(false);
      expect(operation?.parameters.find((p) => p.name === 'mediaType')?.required).toBe(true);
    }
    expect(Object.keys(doc.components.schemas.CatalogCard?.properties ?? {}).sort()).toEqual(
      [
        'mediaType',
        'tmdbId',
        'title',
        'year',
        'genreIds',
        'posterPath',
        'overview',
        'voteAverage',
        'voteCount',
        'originCountry',
        'provider',
        'latestSeason',
      ].sort(),
    );
    expect(doc.components.schemas.GenreList?.properties).toHaveProperty('data');
    expect(doc.components.schemas.WatchProvider?.properties).toHaveProperty('providerId');
  });
});
