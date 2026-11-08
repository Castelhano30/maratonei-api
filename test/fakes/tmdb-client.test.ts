import { beforeEach, describe, expect, it } from 'vitest';
import type { TmdbClient, TmdbMediaType } from '../../src/lib/tmdb/index.js';
import {
  catalogItem,
  catalogItems,
  createFakeTmdb,
  movieDetail,
  tvDetail,
  type FakeTmdbClient,
} from './tmdb-client.js';

let fake: FakeTmdbClient;
beforeEach(() => {
  fake = createFakeTmdb();
});

const idsOf = (items: { tmdbId: number }[]) => items.map((item) => item.tmdbId);

describe('factories', () => {
  it('detalhes trazem os padrões dos campos novos', () => {
    expect(movieDetail()).toMatchObject({
      voteAverage: 7.8,
      voteCount: 12000,
      productionCountries: ['US'],
      numberOfSeasons: null,
    });
    expect(tvDetail()).toMatchObject({
      voteAverage: 8.7,
      voteCount: 5000,
      productionCountries: ['DE'],
      numberOfSeasons: 3,
    });
  });

  it('catalogItem é filme por padrão, com ids únicos crescentes', () => {
    const first = catalogItem();
    const second = catalogItem();
    expect(first.mediaType).toBe('MOVIE');
    expect(first.originCountry).toBeNull();
    expect(second.tmdbId).toBeGreaterThan(first.tmdbId);
  });

  it('catalogItem aceita overrides, inclusive tmdbId', () => {
    expect(catalogItem({ tmdbId: 7, title: 'Duna', voteAverage: null })).toMatchObject({
      tmdbId: 7,
      title: 'Duna',
      voteAverage: null,
    });
  });

  it('catalogItems gera a quantidade pedida do tipo, aplicando overrides', () => {
    const items = catalogItems('TV', 3, { voteCount: 9 });
    expect(items).toHaveLength(3);
    expect(new Set(idsOf(items)).size).toBe(3);
    expect(items.every((item) => item.mediaType === 'TV' && item.voteCount === 9)).toBe(true);
  });
});

describe('discover', () => {
  it('filtra pelo tipo', async () => {
    const movie = catalogItem();
    const series = catalogItem({ mediaType: 'TV' });
    fake.addCatalogItems(movie, series);
    expect(idsOf((await fake.discover('MOVIE', {})).results)).toEqual([movie.tmdbId]);
    expect(idsOf((await fake.discover('TV', {})).results)).toEqual([series.tmdbId]);
  });

  it('filtra por with_genres e vote_count.gte', async () => {
    const drama = catalogItem({ genreIds: [18, 35], voteCount: 100 });
    const lowVotes = catalogItem({ genreIds: [18], voteCount: 99 });
    const action = catalogItem({ genreIds: [28], voteCount: 500 });
    fake.addCatalogItems(drama, lowVotes, action);

    const byGenre = await fake.discover('MOVIE', { with_genres: '18' });
    expect(idsOf(byGenre.results)).toEqual([drama.tmdbId, lowVotes.tmdbId]);
    const byVotes = await fake.discover('MOVIE', { 'vote_count.gte': '100' });
    expect(idsOf(byVotes.results)).toEqual([drama.tmdbId, action.tmdbId]);
    const both = await fake.discover('MOVIE', { with_genres: '18', 'vote_count.gte': '100' });
    expect(idsOf(both.results)).toEqual([drama.tmdbId]);
  });

  it.each(['popularity.desc', 'revenue.desc', undefined])(
    'sort_by %s mantém a ordem de inserção',
    async (sortBy) => {
      const items = [
        catalogItem({ voteAverage: 1, year: 2000 }),
        catalogItem({ voteAverage: 9, year: 2020 }),
      ];
      fake.addCatalogItems(...items);
      const page = await fake.discover('MOVIE', sortBy ? { sort_by: sortBy } : {});
      expect(idsOf(page.results)).toEqual(idsOf(items));
    },
  );

  it('vote_average.desc ordena decrescente com null por último', async () => {
    const none = catalogItem({ voteAverage: null });
    const low = catalogItem({ voteAverage: 5 });
    const high = catalogItem({ voteAverage: 9 });
    fake.addCatalogItems(none, low, high);
    const page = await fake.discover('MOVIE', { sort_by: 'vote_average.desc' });
    expect(idsOf(page.results)).toEqual([high.tmdbId, low.tmdbId, none.tmdbId]);
  });

  it.each([
    ['MOVIE', 'primary_release_date.desc'],
    ['TV', 'first_air_date.desc'],
  ] as [TmdbMediaType, string][])(
    '%s com %s ordena por ano, de forma estável',
    async (mediaType, sortBy) => {
      const older = catalogItem({ mediaType, year: 2000 });
      const firstRecent = catalogItem({ mediaType, year: 2020 });
      const secondRecent = catalogItem({ mediaType, year: 2020 });
      const unknown = catalogItem({ mediaType, year: null });
      fake.addCatalogItems(unknown, older, firstRecent, secondRecent);
      const page = await fake.discover(mediaType, { sort_by: sortBy });
      expect(idsOf(page.results)).toEqual([
        firstRecent.tmdbId,
        secondRecent.tmdbId,
        older.tmdbId,
        unknown.tmdbId,
      ]);
    },
  );

  it('pagina de 20 em 20, com a página 1 como padrão', async () => {
    const items = catalogItems('MOVIE', 45);
    fake.addCatalogItems(...items);

    const first = await fake.discover('MOVIE', {});
    expect(first).toMatchObject({ page: 1, totalResults: 45, totalPages: 3 });
    expect(idsOf(first.results)).toEqual(idsOf(items.slice(0, 20)));

    const third = await fake.discover('MOVIE', { page: '3' });
    expect(third).toMatchObject({ page: 3, totalResults: 45, totalPages: 3 });
    expect(idsOf(third.results)).toEqual(idsOf(items.slice(40)));

    expect(await fake.discover('MOVIE', { page: '4' })).toMatchObject({ page: 4, results: [] });
  });

  it('guarda os demais parâmetros sem filtrar por eles', async () => {
    const item = catalogItem();
    fake.addCatalogItems(item);
    const params = { with_watch_providers: '8', 'release_date.lte': '2000-01-01' };

    const page = await fake.discover('MOVIE', params);

    expect(idsOf(page.results)).toEqual([item.tmdbId]);
    expect(fake.discoverCalls).toEqual([{ mediaType: 'MOVIE', params }]);
  });
});

describe('getNowPlaying, listGenres e searchByType', () => {
  it('getNowPlaying pagina a lista definida e a substitui', async () => {
    const items = catalogItems('MOVIE', 21);
    fake.setNowPlaying(items);

    const second = await fake.getNowPlaying(2);
    expect(second).toMatchObject({ page: 2, totalResults: 21, totalPages: 2 });
    expect(idsOf(second.results)).toEqual(idsOf(items.slice(20)));

    fake.setNowPlaying([]);
    expect(await fake.getNowPlaying(1)).toEqual({
      page: 1,
      totalResults: 0,
      totalPages: 0,
      results: [],
    });
  });

  it('listGenres devolve os gêneros do tipo, ou vazio', async () => {
    fake.setGenres('TV', [{ id: 18, name: 'Drama' }]);
    expect(await fake.listGenres('TV')).toEqual([{ id: 18, name: 'Drama' }]);
    expect(await fake.listGenres('MOVIE')).toEqual([]);
  });

  it('searchByType filtra o catálogo de detalhes por tipo e nome', async () => {
    fake.add(movieDetail({ tmdbId: 1, name: 'Dark Movie' }), tvDetail({ tmdbId: 2, name: 'Dark' }));
    fake.add(tvDetail({ tmdbId: 3, name: 'Outra' }));

    const page = await fake.searchByType('TV', 'dark', 1);

    expect(page.totalResults).toBe(1);
    expect(page.results).toEqual([
      {
        tmdbId: 2,
        mediaType: 'TV',
        name: 'Dark',
        overview: tvDetail().overview,
        posterPath: tvDetail().posterPath,
        releaseYear: tvDetail().releaseYear,
        genreIds: tvDetail().genreIds,
      },
    ]);
  });
});

describe('contadores', () => {
  async function callEveryMethod() {
    fake.add(movieDetail({ tmdbId: 1 }));
    await Promise.allSettled([
      fake.getPopularMovies(),
      fake.search('a', 1),
      fake.getTitle('MOVIE', 1),
      fake.getSeason(1, 1),
      fake.getProviders('MOVIE', 1),
      fake.getNowPlaying(2),
      fake.discover('TV', { page: '1' }),
      fake.listGenres('TV'),
      fake.searchByType('TV', 'x', 3),
    ]);
  }

  it('registram cada chamada e callCount soma todos os métodos', async () => {
    await callEveryMethod();
    expect(fake.nowPlayingCalls).toEqual([2]);
    expect(fake.discoverCalls).toEqual([{ mediaType: 'TV', params: { page: '1' } }]);
    expect(fake.listGenresCalls).toEqual(['TV']);
    expect(fake.searchByTypeCalls).toEqual([{ mediaType: 'TV', query: 'x', page: 3 }]);
    expect(fake.callCount()).toBe(9);
  });

  it('chamadas que falham também contam', async () => {
    fake.setDown(true);
    await callEveryMethod();
    expect(fake.callCount()).toBe(9);
  });

  it('reset zera contadores, dados e falhas', async () => {
    await callEveryMethod();
    fake.addCatalogItems(catalogItem());
    fake.setNowPlaying([catalogItem()]);
    fake.setGenres('TV', [{ id: 18, name: 'Drama' }]);
    fake.setDown(true);

    fake.reset();

    expect(fake.callCount()).toBe(0);
    expect(fake.discoverCalls).toEqual([]);
    expect(fake.nowPlayingCalls).toEqual([]);
    expect(fake.listGenresCalls).toEqual([]);
    expect(fake.searchByTypeCalls).toEqual([]);
    expect((await fake.discover('MOVIE', {})).results).toEqual([]);
    expect((await fake.getNowPlaying(1)).results).toEqual([]);
    expect(await fake.listGenres('TV')).toEqual([]);
  });
});

describe('setDown', () => {
  const failing = { code: 'TMDB_UNAVAILABLE' };

  const everyMethod: [keyof TmdbClient, (client: FakeTmdbClient) => Promise<unknown>][] = [
    ['getPopularMovies', (c) => c.getPopularMovies()],
    ['search', (c) => c.search('a', 1)],
    ['getTitle', (c) => c.getTitle('MOVIE', 1)],
    ['getSeason', (c) => c.getSeason(1, 1)],
    ['getProviders', (c) => c.getProviders('MOVIE', 1)],
    ['getNowPlaying', (c) => c.getNowPlaying(1)],
    ['discover', (c) => c.discover('MOVIE', {})],
    ['listGenres', (c) => c.listGenres('MOVIE')],
    ['searchByType', (c) => c.searchByType('MOVIE', 'a', 1)],
  ];

  it.each(everyMethod)('sem only, %s falha', async (_method, call) => {
    fake.setDown(true);
    await expect(call(fake)).rejects.toMatchObject(failing);
  });

  it('setDown(false) volta ao normal', async () => {
    fake.setDown(true);
    fake.setDown(false);
    await expect(fake.discover('MOVIE', {})).resolves.toMatchObject({ results: [] });
  });

  it('com only, falham apenas esses métodos', async () => {
    fake.setDown(true, ['discover', 'listGenres']);
    await expect(fake.discover('MOVIE', {})).rejects.toMatchObject(failing);
    await expect(fake.listGenres('MOVIE')).rejects.toMatchObject(failing);
    await expect(fake.getNowPlaying(1)).resolves.toMatchObject({ results: [] });
    await expect(fake.search('a', 1)).resolves.toMatchObject({ results: [] });
  });

  it('setDown(true, only) substitui uma queda total', async () => {
    fake.setDown(true);
    fake.setDown(true, ['discover']);
    await expect(fake.discover('MOVIE', {})).rejects.toMatchObject(failing);
    await expect(fake.getNowPlaying(1)).resolves.toMatchObject({ results: [] });
  });

  it('setDown(false, only) recupera só esses métodos', async () => {
    fake.setDown(true);
    fake.setDown(false, ['discover']);
    await expect(fake.discover('MOVIE', {})).resolves.toMatchObject({ results: [] });
    await expect(fake.getNowPlaying(1)).rejects.toMatchObject(failing);
  });

  it('erros de título desconhecido seguem como TITLE_NOT_FOUND', async () => {
    await expect(fake.getTitle('MOVIE', 999)).rejects.toMatchObject({ code: 'TITLE_NOT_FOUND' });
    await expect(fake.getProviders('MOVIE', 999)).rejects.toMatchObject({
      code: 'TITLE_NOT_FOUND',
    });
  });
});
