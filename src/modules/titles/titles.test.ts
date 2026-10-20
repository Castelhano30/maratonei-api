import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { setTmdbClient, unconfiguredTmdbClient } from '../../lib/tmdb/index.js';
import { testApp } from '../../../test/helpers/app.js';
import { allowedOrigin, asUser } from '../../../test/helpers/as-user.js';
import { fakeTmdb } from '../../../test/helpers/tmdb.js';
import {
  movieDetail,
  providersDetail,
  seasonDetail,
  tvDetail,
} from '../../../test/fakes/tmdb-client.js';
import { createTitle } from '../../../test/factories/title.js';
import { clearTitleCache, ensureTitle, TITLE_CACHE_TTL_MS } from './index.js';
import { PROVIDERS_MEMORY_TTL_MS, SEASON_MEMORY_TTL_MS } from './titles.service.js';

describe('sem sessão (401 UNAUTHENTICATED)', () => {
  it.each(['/api/v1/titles/search?q=duna', '/api/v1/titles/MOVIE/1'])('GET %s', async (path) => {
    const res = await request(testApp()).get(path).set('Origin', allowedOrigin());
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('GET /titles/search (CAP-11)', () => {
  it('devolve Page<TitleSummary> com pageSize 20', async () => {
    fakeTmdb.add(movieDetail(), tvDetail());
    const agent = await asUser();

    const res = await agent.get('/api/v1/titles/search').query({ q: 'duna' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [
        {
          tmdbId: 438631,
          mediaType: 'MOVIE',
          name: 'Duna',
          overview: 'Paul Atreides une forças com os Fremen.',
          posterPath: '/duna.jpg',
          releaseYear: 2021,
          genreIds: [878, 12],
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
  });

  it('repassa a página pedida e o texto sem espaços nas pontas', async () => {
    const agent = await asUser();
    await agent.get('/api/v1/titles/search').query({ q: '  dark  ', page: 3 });
    expect(fakeTmdb.searchCalls).toEqual([{ query: 'dark', page: 3 }]);
  });

  it.each([
    [{}, 'sem q'],
    [{ q: '   ' }, 'q vazio'],
    [{ q: 'x'.repeat(101) }, 'q longo'],
    [{ q: 'a', page: 0 }, 'page 0'],
    [{ q: 'a', page: 501 }, 'page acima do teto do TMDB'],
  ])('400 VALIDATION_FAILED: %j (%s)', async (query, _label) => {
    const agent = await asUser();
    const res = await agent.get('/api/v1/titles/search').query(query);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(fakeTmdb.searchCalls).toHaveLength(0);
  });

  it('TMDB fora → 503 TMDB_UNAVAILABLE', async () => {
    fakeTmdb.setDown(true);
    const agent = await asUser();
    const res = await agent.get('/api/v1/titles/search').query({ q: 'duna' });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'TMDB_UNAVAILABLE' });
  });

  it('sem TMDB_API_KEY → 503 TMDB_UNAVAILABLE', async () => {
    setTmdbClient(unconfiguredTmdbClient);
    const agent = await asUser();
    const res = await agent.get('/api/v1/titles/search').query({ q: 'duna' });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'TMDB_UNAVAILABLE' });
  });
});

describe('GET /titles/:mediaType/:tmdbId (CAP-12)', () => {
  it('detalhe de filme: gêneros, elenco, duração e trailer', async () => {
    fakeTmdb.add(movieDetail());
    const agent = await asUser();

    const res = await agent.get('/api/v1/titles/MOVIE/438631');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      tmdbId: 438631,
      mediaType: 'MOVIE',
      name: 'Duna',
      genres: [
        { id: 878, name: 'Ficção científica' },
        { id: 12, name: 'Aventura' },
      ],
      runtime: 155,
      seasons: null,
      cast: [{ name: 'Timothée Chalamet', character: 'Paul Atreides' }],
      trailer: { site: 'YouTube', key: 'n9xhJrPXop4' },
    });
  });

  it('detalhe de série: temporadas e sem duração', async () => {
    fakeTmdb.add(tvDetail());
    const agent = await asUser();

    const res = await agent.get('/api/v1/titles/TV/70523');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mediaType: 'TV', runtime: null, trailer: null, cast: [] });
    expect(res.body.seasons).toHaveLength(3);
    expect(res.body.seasons[0]).toEqual({ season: 1, episodeCount: 10 });
  });

  it('não persiste Title só por consultar o detalhe', async () => {
    fakeTmdb.add(movieDetail());
    const agent = await asUser();
    await agent.get('/api/v1/titles/MOVIE/438631').expect(200);
    expect(await prisma.title.count()).toBe(0);
  });

  it('usa o cache em memória na segunda consulta', async () => {
    fakeTmdb.add(movieDetail());
    const agent = await asUser();
    await agent.get('/api/v1/titles/MOVIE/438631').expect(200);
    await agent.get('/api/v1/titles/MOVIE/438631').expect(200);
    expect(fakeTmdb.getTitleCalls).toHaveLength(1);
  });

  it('desconhecido no TMDB → 404 TITLE_NOT_FOUND', async () => {
    const agent = await asUser();
    const res = await agent.get('/api/v1/titles/MOVIE/999');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'TITLE_NOT_FOUND' });
  });

  it.each([
    '/api/v1/titles/SERIE/1',
    '/api/v1/titles/movie/1',
    '/api/v1/titles/MOVIE/abc',
    '/api/v1/titles/MOVIE/0',
  ])('400 VALIDATION_FAILED: %s', async (path) => {
    const agent = await asUser();
    const res = await agent.get(path);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('TMDB fora e Title em cache → 200 a partir do cache (sem elenco e trailer)', async () => {
    await createTitle({
      tmdbId: 438631,
      name: 'Duna',
      releaseYear: 2021,
      genreIds: [878],
      genres: ['Ficção científica'],
      runtime: 155,
    });
    fakeTmdb.setDown(true);
    const agent = await asUser();

    const res = await agent.get('/api/v1/titles/MOVIE/438631');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Duna',
      genres: [{ id: 878, name: 'Ficção científica' }],
      runtime: 155,
      cast: [],
      trailer: null,
    });
  });

  it('TMDB fora e sem cache → 503 TMDB_UNAVAILABLE', async () => {
    fakeTmdb.setDown(true);
    const agent = await asUser();
    const res = await agent.get('/api/v1/titles/MOVIE/438631');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'TMDB_UNAVAILABLE' });
  });

  it('com a linha Title existente, a consulta bem-sucedida a atualiza', async () => {
    await createTitle({ tmdbId: 438631, name: 'Nome antigo', cachedAt: new Date(2020, 0, 1) });
    fakeTmdb.add(movieDetail());
    const agent = await asUser();
    await agent.get('/api/v1/titles/MOVIE/438631').expect(200);
    const row = await prisma.title.findFirstOrThrow({ where: { tmdbId: 438631 } });
    expect(row.name).toBe('Duna');
    expect(row.cachedAt.getFullYear()).toBeGreaterThan(2020);
  });
});

describe('GET /titles/TV/:tmdbId/seasons/:season (CAP-18)', () => {
  it('devolve os episódios e usa o cache em memória na segunda consulta', async () => {
    fakeTmdb.addSeason(70523, seasonDetail(1, 3));
    const agent = await asUser();
    const res = await agent.get('/api/v1/titles/TV/70523/seasons/1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ season: 1, name: 'Temporada 1' });
    expect(res.body.episodes).toHaveLength(3);
    expect(res.body.episodes[0]).toEqual({
      episode: 1,
      name: 'Episódio 1',
      overview: 'Sinopse do episódio 1.',
      airDate: '2017-12-01',
      runtime: 50,
      stillPath: '/s1e1.jpg',
    });
    await agent.get('/api/v1/titles/TV/70523/seasons/1').expect(200);
    expect(fakeTmdb.getSeasonCalls).toHaveLength(1);
    expect(await prisma.title.count()).toBe(0);
  });

  it('refaz a consulta da temporada depois de 1 h', async () => {
    fakeTmdb.addSeason(70523, seasonDetail(1, 3));
    const agent = await asUser();
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now');
    try {
      spy.mockReturnValue(now);
      await agent.get('/api/v1/titles/TV/70523/seasons/1').expect(200);
      spy.mockReturnValue(now + SEASON_MEMORY_TTL_MS - 1000);
      await agent.get('/api/v1/titles/TV/70523/seasons/1').expect(200);
      expect(fakeTmdb.getSeasonCalls).toHaveLength(1);
      spy.mockReturnValue(now + SEASON_MEMORY_TTL_MS + 1000);
      await agent.get('/api/v1/titles/TV/70523/seasons/1').expect(200);
      expect(fakeTmdb.getSeasonCalls).toHaveLength(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('temporada inexistente → 404 TITLE_NOT_FOUND', async () => {
    const agent = await asUser();
    const res = await agent.get('/api/v1/titles/TV/70523/seasons/9');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'TITLE_NOT_FOUND' });
  });

  it('TMDB fora → 503 TMDB_UNAVAILABLE', async () => {
    fakeTmdb.setDown(true);
    const agent = await asUser();
    const res = await agent.get('/api/v1/titles/TV/70523/seasons/1');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'TMDB_UNAVAILABLE' });
  });

  it.each(['abc', '0', '-1', '1.5'])('400 VALIDATION_FAILED: temporada %s', async (season) => {
    const agent = await asUser();
    const res = await agent.get(`/api/v1/titles/TV/70523/seasons/${season}`);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('sem sessão → 401', async () => {
    const res = await request(testApp())
      .get('/api/v1/titles/TV/70523/seasons/1')
      .set('Origin', allowedOrigin());
    expect(res.status).toBe(401);
  });
});

describe('GET /titles/:mediaType/:tmdbId/providers (CAP-19)', () => {
  it('devolve flatrate, rent, buy e link; a 2ª chamada não toca o TMDB', async () => {
    fakeTmdb.add(tvDetail()).addProviders('TV', 70523, providersDetail());
    const agent = await asUser();
    const res = await agent.get('/api/v1/titles/TV/70523/providers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      flatrate: [{ providerId: 8, providerName: 'Netflix', logoPath: '/netflix.jpg' }],
      rent: [{ providerId: 2, providerName: 'Apple TV', logoPath: '/apple.jpg' }],
      buy: [],
      link: 'https://www.themoviedb.org/tv/70523/watch?locale=BR',
    });
    await agent.get('/api/v1/titles/TV/70523/providers').expect(200);
    expect(fakeTmdb.getProvidersCalls).toHaveLength(1);
  });

  it('refaz a consulta depois de 24 h', async () => {
    fakeTmdb.add(movieDetail());
    const agent = await asUser();
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now');
    try {
      spy.mockReturnValue(now);
      await agent.get('/api/v1/titles/MOVIE/438631/providers').expect(200);
      spy.mockReturnValue(now + PROVIDERS_MEMORY_TTL_MS - 1000);
      await agent.get('/api/v1/titles/MOVIE/438631/providers').expect(200);
      expect(fakeTmdb.getProvidersCalls).toHaveLength(1);
      spy.mockReturnValue(now + PROVIDERS_MEMORY_TTL_MS + 1000);
      await agent.get('/api/v1/titles/MOVIE/438631/providers').expect(200);
      expect(fakeTmdb.getProvidersCalls).toHaveLength(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('sem dados BR → listas vazias e link null', async () => {
    fakeTmdb.add(movieDetail());
    const agent = await asUser();
    const res = await agent.get('/api/v1/titles/MOVIE/438631/providers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ flatrate: [], rent: [], buy: [], link: null });
  });

  it('desconhecido → 404 TITLE_NOT_FOUND; TMDB fora → 503', async () => {
    const agent = await asUser();
    const missing = await agent.get('/api/v1/titles/MOVIE/999/providers');
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: 'TITLE_NOT_FOUND' });
    fakeTmdb.setDown(true);
    const down = await agent.get('/api/v1/titles/MOVIE/999/providers');
    expect(down.status).toBe(503);
    expect(down.body).toMatchObject({ code: 'TMDB_UNAVAILABLE' });
  });

  it('400 em mediaType inválido; 401 sem sessão', async () => {
    const agent = await asUser();
    const res = await agent.get('/api/v1/titles/SERIE/1/providers');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    const anon = await request(testApp())
      .get('/api/v1/titles/MOVIE/1/providers')
      .set('Origin', allowedOrigin());
    expect(anon.status).toBe(401);
  });
});

describe('ensureTitle (cache da tabela Title)', () => {
  it('cria a linha na primeira vez e reaproveita enquanto fresca', async () => {
    fakeTmdb.add(movieDetail(), tvDetail());

    const first = await ensureTitle('MOVIE', 438631);
    clearTitleCache();
    const second = await ensureTitle('MOVIE', 438631);
    const tv = await ensureTitle('TV', 70523);

    expect(second.id).toBe(first.id);
    expect(fakeTmdb.getTitleCalls).toHaveLength(2);
    expect(first).toMatchObject({
      name: 'Duna',
      genreIds: [878, 12],
      genres: ['Ficção científica', 'Aventura'],
      runtime: 155,
      seasons: null,
    });
    expect(tv.seasons).toEqual([
      { season: 1, episodeCount: 10 },
      { season: 2, episodeCount: 8 },
      { season: 3, episodeCount: 8 },
    ]);
    expect(await prisma.title.count()).toBe(2);
  });

  it('atualiza a linha depois de TITLE_CACHE_TTL', async () => {
    const stale = await createTitle({
      tmdbId: 438631,
      name: 'Velho',
      cachedAt: new Date(Date.now() - TITLE_CACHE_TTL_MS - 60_000),
    });
    fakeTmdb.add(movieDetail());

    const fresh = await ensureTitle('MOVIE', 438631);

    expect(fresh.id).toBe(stale.id);
    expect(fresh.name).toBe('Duna');
    expect(fakeTmdb.getTitleCalls).toHaveLength(1);
  });

  it('linha vencida sobrevive a falha do TMDB; sem linha propaga 503', async () => {
    await createTitle({
      tmdbId: 438631,
      name: 'Velho',
      cachedAt: new Date(Date.now() - TITLE_CACHE_TTL_MS - 60_000),
    });
    fakeTmdb.setDown(true);

    expect((await ensureTitle('MOVIE', 438631)).name).toBe('Velho');
    await expect(ensureTitle('MOVIE', 1)).rejects.toMatchObject({ code: 'TMDB_UNAVAILABLE' });
  });
});
