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
  });

  it('usa o cliente injetado', () => {
    const fake = unconfiguredTmdbClient;
    setTmdbClient(fake);
    expect(getTmdb()).toBe(fake);
    setTmdbClient(undefined);
  });
});
