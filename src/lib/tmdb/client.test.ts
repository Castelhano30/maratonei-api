import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../http/app-error.js';
import { startFakeTmdb, type FakeTmdbServer } from '../../../test/fakes/tmdb-server.js';
import { createHttpTmdbClient, getTmdb, setTmdbClient, unconfiguredTmdbClient } from './index.js';

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

  it('usa o cliente injetado', () => {
    const fake = unconfiguredTmdbClient;
    setTmdbClient(fake);
    expect(getTmdb()).toBe(fake);
    setTmdbClient(undefined);
  });
});
