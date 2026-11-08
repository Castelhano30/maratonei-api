import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../http/app-error.js';
import { startFakeTmdb, type FakeTmdbServer } from '../../../test/fakes/tmdb-server.js';
import {
  createHttpTmdbClient,
  getTmdb,
  setTmdbClient,
  unconfiguredTmdbClient,
  type TmdbClient,
} from './index.js';

const API_KEY = 'chave-secreta-de-teste';

let tmdb: FakeTmdbServer;
beforeAll(async () => {
  tmdb = await startFakeTmdb();
});
afterAll(async () => {
  await tmdb.close();
});
beforeEach(() => {
  tmdb.reset();
});

function client(options: { timeoutMs?: number } = {}) {
  return createHttpTmdbClient({
    apiKey: API_KEY,
    baseUrl: tmdb.baseUrl,
    retryDelayMs: 1,
    ...options,
  });
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  return undefined;
}

describe('createHttpTmdbClient.getPopularMovies', () => {
  it('busca primeira página pt-BR/BR, exclui adultos e normaliza filmes', async () => {
    tmdb.on('GET', '/movie/popular', () => ({
      body: {
        page: 1,
        total_results: 40,
        results: [
          {
            id: 1,
            adult: false,
            title: 'Duna',
            overview: 'Areia.',
            poster_path: '/d.jpg',
            release_date: '2021-09-15',
            genre_ids: [878],
          },
          { id: 2, adult: true, title: 'Adulto' },
          { id: 3, adult: false, title: 'Sem dados' },
          { id: 'inválido', adult: false },
          { id: 4, title: 'Sem classificação' },
        ],
      },
    }));
    const result = await client().getPopularMovies();
    const query = tmdb.requests[0]?.query;
    expect(query?.get('language')).toBe('pt-BR');
    expect(query?.get('region')).toBe('BR');
    expect(query?.get('page')).toBe('1');
    expect(query?.get('include_adult')).toBe('false');
    expect(result).toEqual({
      page: 1,
      totalResults: 40,
      results: [
        {
          tmdbId: 1,
          mediaType: 'MOVIE',
          name: 'Duna',
          overview: 'Areia.',
          posterPath: '/d.jpg',
          releaseYear: 2021,
          genreIds: [878],
        },
        {
          tmdbId: 3,
          mediaType: 'MOVIE',
          name: 'Sem dados',
          overview: '',
          posterPath: null,
          releaseYear: null,
          genreIds: [],
        },
      ],
    });
  });

  it('resposta inválida vira indisponibilidade', async () => {
    tmdb.on('GET', '/movie/popular', () => ({ body: { results: [] } }));
    expect(await codeOf(client().getPopularMovies())).toBe('TMDB_UNAVAILABLE');
  });
});

describe('createHttpTmdbClient.search', () => {
  it('pede pt-BR com a chave, mantém só filmes e séries e normaliza os campos', async () => {
    tmdb.on('GET', '/search/multi', () => ({
      body: {
        page: 2,
        total_results: 41,
        results: [
          {
            id: 1,
            media_type: 'movie',
            title: 'Duna',
            overview: 'Areia.',
            poster_path: '/d.jpg',
            release_date: '2021-09-15',
            genre_ids: [878],
          },
          {
            id: 2,
            media_type: 'tv',
            name: 'Dark',
            overview: '',
            poster_path: null,
            first_air_date: '2017-12-01',
            genre_ids: [18],
          },
          { id: 3, media_type: 'person', name: 'Alguém' },
          { id: 4, media_type: 'movie', title: 'Sem data', release_date: '' },
        ],
      },
    }));

    const page = await client().search('dun', 2);

    const request = tmdb.requests.at(-1);
    expect(request?.query.get('language')).toBe('pt-BR');
    expect(request?.query.get('query')).toBe('dun');
    expect(request?.query.get('page')).toBe('2');
    expect(request?.query.get('api_key')).toBe(API_KEY);
    expect(page.page).toBe(2);
    expect(page.totalResults).toBe(41);
    expect(page.results).toEqual([
      {
        tmdbId: 1,
        mediaType: 'MOVIE',
        name: 'Duna',
        overview: 'Areia.',
        posterPath: '/d.jpg',
        releaseYear: 2021,
        genreIds: [878],
      },
      {
        tmdbId: 2,
        mediaType: 'TV',
        name: 'Dark',
        overview: '',
        posterPath: null,
        releaseYear: 2017,
        genreIds: [18],
      },
      {
        tmdbId: 4,
        mediaType: 'MOVIE',
        name: 'Sem data',
        overview: '',
        posterPath: null,
        releaseYear: null,
        genreIds: [],
      },
    ]);
  });
});

describe('createHttpTmdbClient.getTitle', () => {
  it('normaliza filme: gêneros, elenco limitado a 10, duração e trailer em pt', async () => {
    tmdb.on('GET', '/movie/438631', () => ({
      body: {
        id: 438631,
        title: 'Duna',
        overview: 'Areia.',
        poster_path: '/d.jpg',
        release_date: '2021-09-15',
        genres: [{ id: 878, name: 'Ficção científica' }],
        runtime: 155,
        credits: {
          cast: Array.from({ length: 15 }, (_, index) => ({
            name: `Ator ${index}`,
            character: index === 0 ? 'Paul' : '',
            profile_path: null,
          })),
        },
        videos: {
          results: [
            { key: 'en1', name: 'Teaser', site: 'YouTube', type: 'Teaser', iso_639_1: 'en' },
            { key: 'en2', name: 'Trailer EN', site: 'YouTube', type: 'Trailer', iso_639_1: 'en' },
            { key: 'pt1', name: 'Trailer PT', site: 'YouTube', type: 'Trailer', iso_639_1: 'pt' },
            { key: 'vm', name: 'Vimeo', site: 'Vimeo', type: 'Trailer', iso_639_1: 'pt' },
          ],
        },
      },
    }));

    const detail = await client().getTitle('MOVIE', 438631);

    expect(tmdb.requests.at(-1)?.query.get('append_to_response')).toBe('credits,videos');
    expect(detail).toMatchObject({
      tmdbId: 438631,
      mediaType: 'MOVIE',
      name: 'Duna',
      releaseYear: 2021,
      genreIds: [878],
      genres: [{ id: 878, name: 'Ficção científica' }],
      runtime: 155,
      seasons: null,
      trailer: { site: 'YouTube', key: 'pt1', name: 'Trailer PT' },
    });
    expect(detail.cast).toHaveLength(10);
    expect(detail.cast[0]).toEqual({ name: 'Ator 0', character: 'Paul', profilePath: null });
    expect(detail.cast[1]?.character).toBeNull();
  });

  it('normaliza série: temporadas sem especiais e sem duração', async () => {
    tmdb.on('GET', '/tv/70523', () => ({
      body: {
        id: 70523,
        name: 'Dark',
        first_air_date: '2017-12-01',
        genres: [{ id: 18, name: 'Drama' }],
        seasons: [
          { season_number: 0, episode_count: 3 },
          { season_number: 1, episode_count: 10 },
          { season_number: 2, episode_count: 8 },
        ],
        runtime: 50,
      },
    }));

    const detail = await client().getTitle('TV', 70523);

    expect(detail).toMatchObject({
      mediaType: 'TV',
      name: 'Dark',
      releaseYear: 2017,
      runtime: null,
    });
    expect(detail.seasons).toEqual([
      { season: 1, episodeCount: 10 },
      { season: 2, episodeCount: 8 },
    ]);
    expect(detail.trailer).toBeNull();
    expect(detail.cast).toEqual([]);
  });

  it('filme: lê nota, votos e países, e numberOfSeasons fica null', async () => {
    tmdb.on('GET', '/movie/1', () => ({
      body: {
        id: 1,
        title: 'Duna',
        vote_average: 7.8,
        vote_count: 12000,
        production_countries: [
          { iso_3166_1: 'US', name: 'United States of America' },
          { iso_3166_1: 'CA', name: 'Canada' },
        ],
        number_of_seasons: 9,
      },
    }));

    expect(await client().getTitle('MOVIE', 1)).toMatchObject({
      voteAverage: 7.8,
      voteCount: 12000,
      productionCountries: ['US', 'CA'],
      numberOfSeasons: null,
    });
  });

  it('série: lê number_of_seasons', async () => {
    tmdb.on('GET', '/tv/2', () => ({
      body: {
        id: 2,
        name: 'Dark',
        vote_average: 8.7,
        vote_count: 5000,
        production_countries: [{ iso_3166_1: 'DE', name: 'Germany' }],
        number_of_seasons: 3,
      },
    }));

    expect(await client().getTitle('TV', 2)).toMatchObject({
      voteAverage: 8.7,
      voteCount: 5000,
      productionCountries: ['DE'],
      numberOfSeasons: 3,
    });
  });

  it.each([
    ['ausentes', {}],
    [
      'nulos',
      {
        vote_average: null,
        vote_count: null,
        production_countries: null,
        number_of_seasons: null,
      },
    ],
  ] as [string, Record<string, null>][])('campos novos %s: padrões', async (_name, fields) => {
    tmdb.on('GET', '/tv/3', () => ({ body: { id: 3, name: 'Sem dados', ...fields } }));

    expect(await client().getTitle('TV', 3)).toMatchObject({
      voteAverage: null,
      voteCount: 0,
      productionCountries: [],
      numberOfSeasons: null,
    });
  });

  it('404 do TMDB vira TITLE_NOT_FOUND, sem retentativa', async () => {
    const code = await codeOf(client().getTitle('MOVIE', 999));
    expect(code).toBe('TITLE_NOT_FOUND');
    expect(tmdb.requests).toHaveLength(1);
  });
});

describe('createHttpTmdbClient.getSeason', () => {
  it('normaliza os episódios da temporada em pt-BR', async () => {
    tmdb.on('GET', '/tv/70523/season/1', () => ({
      body: {
        season_number: 1,
        name: 'Temporada 1',
        episodes: [
          {
            episode_number: 1,
            name: 'Segredos',
            overview: 'Um menino some.',
            air_date: '2017-12-01',
            runtime: 52,
            still_path: '/e1.jpg',
          },
          { episode_number: 2, name: null, overview: null, air_date: '', still_path: null },
        ],
      },
    }));

    const season = await client().getSeason(70523, 1);

    expect(tmdb.requests.at(-1)?.query.get('language')).toBe('pt-BR');
    expect(season).toEqual({
      season: 1,
      name: 'Temporada 1',
      episodes: [
        {
          episode: 1,
          name: 'Segredos',
          overview: 'Um menino some.',
          airDate: '2017-12-01',
          runtime: 52,
          stillPath: '/e1.jpg',
        },
        { episode: 2, name: '', overview: '', airDate: null, runtime: null, stillPath: null },
      ],
    });
  });

  it('temporada inexistente (404) vira TITLE_NOT_FOUND', async () => {
    expect(await codeOf(client().getSeason(70523, 9))).toBe('TITLE_NOT_FOUND');
  });
});

describe('createHttpTmdbClient.getProviders', () => {
  it('lê só a região BR e normaliza as listas', async () => {
    tmdb.on('GET', '/tv/70523/watch/providers', () => ({
      body: {
        id: 70523,
        results: {
          US: { link: 'https://tmdb/us', flatrate: [{ provider_id: 9, provider_name: 'Prime' }] },
          BR: {
            link: 'https://tmdb/br',
            flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.jpg' }],
            buy: [{ provider_id: 2, provider_name: 'Apple TV', logo_path: null }],
          },
        },
      },
    }));

    expect(await client().getProviders('TV', 70523)).toEqual({
      flatrate: [{ providerId: 8, providerName: 'Netflix', logoPath: '/n.jpg' }],
      rent: [],
      buy: [{ providerId: 2, providerName: 'Apple TV', logoPath: null }],
      link: 'https://tmdb/br',
    });
  });

  it('usa o endpoint de filme e devolve vazio sem dados BR', async () => {
    tmdb.on('GET', '/movie/1/watch/providers', () => ({
      body: { id: 1, results: { US: { link: 'x' } } },
    }));
    expect(await client().getProviders('MOVIE', 1)).toEqual({
      flatrate: [],
      rent: [],
      buy: [],
      link: null,
    });
  });

  it('título desconhecido (404) vira TITLE_NOT_FOUND', async () => {
    expect(await codeOf(client().getProviders('MOVIE', 999))).toBe('TITLE_NOT_FOUND');
  });
});

const LONG_OVERVIEW = 'Sinopse bem longa. '.repeat(200);

describe('createHttpTmdbClient.getNowPlaying', () => {
  it('pede a página em pt-BR/BR, descarta adultos e inválidos e normaliza', async () => {
    tmdb.on('GET', '/movie/now_playing', () => ({
      body: {
        page: 3,
        total_results: 45,
        total_pages: 3,
        results: [
          {
            id: 1,
            adult: false,
            title: 'Duna',
            overview: LONG_OVERVIEW,
            poster_path: '/d.jpg',
            release_date: '2021-09-15',
            genre_ids: [878],
            vote_average: 7.8,
            vote_count: 12000,
            origin_country: ['US'],
          },
          { id: 2, adult: true, title: 'Adulto' },
          { id: 'inválido', adult: false },
          { id: 3, title: 'Sem classificação' },
          { id: 4, adult: false },
        ],
      },
    }));

    const page = await client().getNowPlaying(3);

    const request = tmdb.requests.at(-1);
    expect(request?.path).toBe('/movie/now_playing');
    expect(request?.query.get('api_key')).toBe(API_KEY);
    expect(request?.query.get('language')).toBe('pt-BR');
    expect(request?.query.get('region')).toBe('BR');
    expect(request?.query.get('page')).toBe('3');
    expect(page).toEqual({
      page: 3,
      totalResults: 45,
      totalPages: 3,
      results: [
        {
          tmdbId: 1,
          mediaType: 'MOVIE',
          title: 'Duna',
          year: 2021,
          genreIds: [878],
          posterPath: '/d.jpg',
          overview: LONG_OVERVIEW,
          voteAverage: 7.8,
          voteCount: 12000,
          originCountry: null,
        },
        {
          tmdbId: 4,
          mediaType: 'MOVIE',
          title: '',
          year: null,
          genreIds: [],
          posterPath: null,
          overview: '',
          voteAverage: null,
          voteCount: 0,
          originCountry: null,
        },
      ],
    });
  });

  it('página sem total_pages vira indisponibilidade', async () => {
    tmdb.on('GET', '/movie/now_playing', () => ({
      body: { page: 1, total_results: 0, results: [] },
    }));
    expect(await codeOf(client().getNowPlaying(1))).toBe('TMDB_UNAVAILABLE');
  });
});

describe('createHttpTmdbClient.discover', () => {
  it('filme: repassa os params e normaliza, descartando adulto e item inválido', async () => {
    tmdb.on('GET', '/discover/movie', () => ({
      body: {
        page: 2,
        total_results: 21,
        total_pages: 2,
        results: [
          {
            id: 1,
            title: 'Duna',
            name: 'Ignorado',
            overview: LONG_OVERVIEW,
            poster_path: '/d.jpg',
            release_date: '2021-09-15',
            first_air_date: '1999-01-01',
            genre_ids: [878, 12],
            vote_average: 7.8,
            vote_count: 12000,
            origin_country: ['US'],
          },
          { id: 2, adult: true, title: 'Adulto' },
          { id: 'inválido', title: 'Quebrado' },
        ],
      },
    }));

    const page = await client().discover('MOVIE', {
      page: '2',
      sort_by: 'popularity.desc',
      region: 'BR',
      with_genres: '878',
    });

    const request = tmdb.requests.at(-1);
    expect(request?.path).toBe('/discover/movie');
    expect(request?.query.get('language')).toBe('pt-BR');
    expect(request?.query.get('include_adult')).toBe('false');
    expect(request?.query.get('page')).toBe('2');
    expect(request?.query.get('sort_by')).toBe('popularity.desc');
    expect(request?.query.get('region')).toBe('BR');
    expect(request?.query.get('with_genres')).toBe('878');
    expect(page).toEqual({
      page: 2,
      totalResults: 21,
      totalPages: 2,
      results: [
        {
          tmdbId: 1,
          mediaType: 'MOVIE',
          title: 'Duna',
          year: 2021,
          genreIds: [878, 12],
          posterPath: '/d.jpg',
          overview: LONG_OVERVIEW,
          voteAverage: 7.8,
          voteCount: 12000,
          originCountry: null,
        },
      ],
    });
  });

  it('série: usa name, first_air_date e origin_country[0]', async () => {
    tmdb.on('GET', '/discover/tv', () => ({
      body: {
        page: 1,
        total_results: 2,
        total_pages: 1,
        results: [
          {
            id: 7,
            name: 'Dark',
            title: 'Ignorado',
            overview: LONG_OVERVIEW,
            poster_path: null,
            first_air_date: '2017-12-01',
            release_date: '1999-01-01',
            genre_ids: [18],
            vote_average: 8.7,
            vote_count: 5000,
            origin_country: ['DE', 'US'],
          },
          { id: 8, name: 'Sem país', origin_country: [] },
        ],
      },
    }));

    const page = await client().discover('TV', { page: '1' });

    expect(tmdb.requests.at(-1)?.path).toBe('/discover/tv');
    expect(page.results).toEqual([
      {
        tmdbId: 7,
        mediaType: 'TV',
        title: 'Dark',
        year: 2017,
        genreIds: [18],
        posterPath: null,
        overview: LONG_OVERVIEW,
        voteAverage: 8.7,
        voteCount: 5000,
        originCountry: 'DE',
      },
      {
        tmdbId: 8,
        mediaType: 'TV',
        title: 'Sem país',
        year: null,
        genreIds: [],
        posterPath: null,
        overview: '',
        voteAverage: null,
        voteCount: 0,
        originCountry: null,
      },
    ]);
  });

  it('params não sobrescrevem chave, idioma nem include_adult', async () => {
    tmdb.on('GET', '/discover/movie', () => ({
      body: { page: 1, total_results: 0, total_pages: 0, results: [] },
    }));

    await client().discover('MOVIE', {
      api_key: 'outra-chave',
      language: 'en-US',
      include_adult: 'true',
    });

    const query = tmdb.requests.at(-1)?.query;
    expect(query?.getAll('api_key')).toEqual([API_KEY]);
    expect(query?.getAll('language')).toEqual(['pt-BR']);
    expect(query?.getAll('include_adult')).toEqual(['false']);
  });
});

describe('createHttpTmdbClient.listGenres', () => {
  it.each([
    ['MOVIE', '/genre/movie/list'],
    ['TV', '/genre/tv/list'],
  ] as const)('%s: usa o endpoint do tipo e descarta gênero inválido', async (mediaType, path) => {
    tmdb.on('GET', path, () => ({
      body: {
        genres: [{ id: 18, name: 'Drama', extra: true }, { id: 'x', name: 'Ruim' }, { id: 35 }],
      },
    }));

    const genres = await client().listGenres(mediaType);

    const request = tmdb.requests.at(-1);
    expect(request?.path).toBe(path);
    expect(request?.query.get('language')).toBe('pt-BR');
    expect(genres).toEqual([{ id: 18, name: 'Drama' }]);
  });

  it('corpo sem genres vira indisponibilidade', async () => {
    tmdb.on('GET', '/genre/movie/list', () => ({ body: {} }));
    expect(await codeOf(client().listGenres('MOVIE'))).toBe('TMDB_UNAVAILABLE');
  });
});

describe('createHttpTmdbClient.searchByType', () => {
  it('filme: resultados sem media_type usam o parâmetro; inválido é descartado', async () => {
    tmdb.on('GET', '/search/movie', () => ({
      body: {
        page: 2,
        total_results: 21,
        total_pages: 2,
        results: [
          {
            id: 1,
            title: 'Duna',
            overview: LONG_OVERVIEW,
            poster_path: '/d.jpg',
            release_date: '2021-09-15',
            genre_ids: [878],
          },
          { id: 'inválido', title: 'Quebrado' },
        ],
      },
    }));

    const page = await client().searchByType('MOVIE', 'dun', 2);

    const request = tmdb.requests.at(-1);
    expect(request?.path).toBe('/search/movie');
    expect(request?.query.get('query')).toBe('dun');
    expect(request?.query.get('page')).toBe('2');
    expect(request?.query.get('language')).toBe('pt-BR');
    expect(request?.query.get('include_adult')).toBe('false');
    expect(page).toEqual({
      page: 2,
      totalResults: 21,
      results: [
        {
          tmdbId: 1,
          mediaType: 'MOVIE',
          name: 'Duna',
          overview: LONG_OVERVIEW,
          posterPath: '/d.jpg',
          releaseYear: 2021,
          genreIds: [878],
        },
      ],
    });
  });

  it('série: usa name e first_air_date', async () => {
    tmdb.on('GET', '/search/tv', () => ({
      body: {
        page: 1,
        total_results: 1,
        results: [{ id: 7, name: 'Dark', first_air_date: '2017-12-01' }],
      },
    }));

    const page = await client().searchByType('TV', 'dark', 1);

    expect(tmdb.requests.at(-1)?.path).toBe('/search/tv');
    expect(page.results).toEqual([
      {
        tmdbId: 7,
        mediaType: 'TV',
        name: 'Dark',
        overview: '',
        posterPath: null,
        releaseYear: 2017,
        genreIds: [],
      },
    ]);
  });
});

describe('falhas dos métodos de catálogo', () => {
  const calls: [string, (tmdbClient: TmdbClient) => Promise<unknown>][] = [
    ['/movie/now_playing', (c) => c.getNowPlaying(1)],
    ['/discover/movie', (c) => c.discover('MOVIE', { page: '1' })],
    ['/discover/tv', (c) => c.discover('TV', { page: '1' })],
    ['/genre/movie/list', (c) => c.listGenres('MOVIE')],
    ['/genre/tv/list', (c) => c.listGenres('TV')],
    ['/search/movie', (c) => c.searchByType('MOVIE', 'x', 1)],
    ['/search/tv', (c) => c.searchByType('TV', 'x', 1)],
  ];

  it.each(calls)('%s: 404 vira TITLE_NOT_FOUND, sem retentativa', async (path, call) => {
    expect(await codeOf(call(client()))).toBe('TITLE_NOT_FOUND');
    expect(tmdb.requests.map((request) => request.path)).toEqual([path]);
  });

  it.each(calls)('%s: 5xx persistente tenta duas vezes', async (path, call) => {
    tmdb.on('GET', path, () => ({ status: 503, body: {} }));
    expect(await codeOf(call(client()))).toBe('TMDB_UNAVAILABLE');
    expect(tmdb.requests).toHaveLength(2);
  });

  it.each(calls)('%s: timeout vira TMDB_UNAVAILABLE', async (path, call) => {
    tmdb.on('GET', path, () => ({ delayMs: 200, body: {} }));
    expect(await codeOf(call(client({ timeoutMs: 20 })))).toBe('TMDB_UNAVAILABLE');
  });

  it.each(calls)('%s: corpo inesperado não vaza a chave no erro', async (path, call) => {
    tmdb.on('GET', path, () => ({ body: { inesperado: true } }));
    const error = await call(client()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('TMDB_UNAVAILABLE');
    expect(JSON.stringify(error)).not.toContain(API_KEY);
    expect((error as AppError).message).not.toContain(API_KEY);
  });
});

describe('falhas do TMDB', () => {
  it('5xx persistente: tenta duas vezes e vira TMDB_UNAVAILABLE', async () => {
    tmdb.on('GET', '/movie/1', () => ({ status: 500, body: {} }));
    expect(await codeOf(client().getTitle('MOVIE', 1))).toBe('TMDB_UNAVAILABLE');
    expect(tmdb.requests).toHaveLength(2);
  });

  it('5xx seguido de sucesso: a retentativa recupera', async () => {
    let calls = 0;
    tmdb.on('GET', '/movie/1', () => {
      calls += 1;
      return calls === 1 ? { status: 502, body: {} } : { body: { id: 1, title: 'Ok' } };
    });
    const detail = await client().getTitle('MOVIE', 1);
    expect(detail.name).toBe('Ok');
    expect(calls).toBe(2);
  });

  it('401 (chave inválida) vira TMDB_UNAVAILABLE sem retentativa', async () => {
    tmdb.on('GET', '/search/multi', () => ({ status: 401, body: { success: false } }));
    expect(await codeOf(client().search('x', 1))).toBe('TMDB_UNAVAILABLE');
    expect(tmdb.requests).toHaveLength(1);
  });

  it('timeout vira TMDB_UNAVAILABLE', async () => {
    tmdb.on('GET', '/movie/1', () => ({ delayMs: 200, body: {} }));
    expect(await codeOf(client({ timeoutMs: 20 }).getTitle('MOVIE', 1))).toBe('TMDB_UNAVAILABLE');
  });

  it('corpo fora do formato vira TMDB_UNAVAILABLE e a chave não vaza no erro', async () => {
    tmdb.on('GET', '/search/multi', () => ({ body: { inesperado: true } }));
    const error = await client()
      .search('x', 1)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(JSON.stringify(error)).not.toContain(API_KEY);
    expect((error as AppError).message).not.toContain(API_KEY);
  });
});

describe('getTmdb', () => {
  it('sem TMDB_API_KEY usa o cliente que responde 503', async () => {
    setTmdbClient(undefined);
    expect(getTmdb()).toBe(unconfiguredTmdbClient);
    expect(await codeOf(getTmdb().search('x', 1))).toBe('TMDB_UNAVAILABLE');
    expect(await codeOf(getTmdb().getTitle('TV', 1))).toBe('TMDB_UNAVAILABLE');
    expect(await codeOf(getTmdb().getSeason(1, 1))).toBe('TMDB_UNAVAILABLE');
    expect(await codeOf(getTmdb().getProviders('TV', 1))).toBe('TMDB_UNAVAILABLE');
  });

  it('sem TMDB_API_KEY os métodos de catálogo rejeitam com TMDB não configurado', async () => {
    const calls = [
      () => unconfiguredTmdbClient.getNowPlaying(1),
      () => unconfiguredTmdbClient.discover('MOVIE', {}),
      () => unconfiguredTmdbClient.listGenres('TV'),
      () => unconfiguredTmdbClient.searchByType('TV', 'x', 1),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({
        code: 'TMDB_UNAVAILABLE',
        message: 'TMDB não configurado.',
      });
    }
  });

  it('usa o cliente injetado', () => {
    const fake = unconfiguredTmdbClient;
    setTmdbClient(fake);
    expect(getTmdb()).toBe(fake);
    setTmdbClient(undefined);
  });
});
