import { AppError } from '../../src/http/app-error.js';
import type {
  TmdbClient,
  TmdbMediaType,
  TmdbProviders,
  TmdbSearchPage,
  TmdbSeasonDetail,
  TmdbTitleDetail,
} from '../../src/lib/tmdb/index.js';

/** Detalhe de filme de exemplo (Duna); `overrides` ajusta qualquer campo. */
export function movieDetail(overrides: Partial<TmdbTitleDetail> = {}): TmdbTitleDetail {
  return {
    tmdbId: 438631,
    mediaType: 'MOVIE',
    name: 'Duna',
    overview: 'Paul Atreides une forças com os Fremen.',
    posterPath: '/duna.jpg',
    releaseYear: 2021,
    genreIds: [878, 12],
    genres: [
      { id: 878, name: 'Ficção científica' },
      { id: 12, name: 'Aventura' },
    ],
    runtime: 155,
    seasons: null,
    cast: [{ name: 'Timothée Chalamet', character: 'Paul Atreides', profilePath: '/tc.jpg' }],
    trailer: { site: 'YouTube', key: 'n9xhJrPXop4', name: 'Trailer oficial' },
    ...overrides,
  };
}

/** Detalhe de série de exemplo (Dark). */
export function tvDetail(overrides: Partial<TmdbTitleDetail> = {}): TmdbTitleDetail {
  return {
    tmdbId: 70523,
    mediaType: 'TV',
    name: 'Dark',
    overview: 'Uma cidade alemã e seus segredos no tempo.',
    posterPath: '/dark.jpg',
    releaseYear: 2017,
    genreIds: [9648, 18],
    genres: [
      { id: 9648, name: 'Mistério' },
      { id: 18, name: 'Drama' },
    ],
    runtime: null,
    seasons: [
      { season: 1, episodeCount: 10 },
      { season: 2, episodeCount: 8 },
      { season: 3, episodeCount: 8 },
    ],
    cast: [],
    trailer: null,
    ...overrides,
  };
}

/** Temporada de exemplo com `episodes` episódios numerados a partir de 1. */
export function seasonDetail(season = 1, episodes = 3): TmdbSeasonDetail {
  return {
    season,
    name: `Temporada ${season}`,
    episodes: Array.from({ length: episodes }, (_, index) => ({
      episode: index + 1,
      name: `Episódio ${index + 1}`,
      overview: `Sinopse do episódio ${index + 1}.`,
      airDate: '2017-12-01',
      runtime: 50,
      stillPath: `/s${season}e${index + 1}.jpg`,
    })),
  };
}

/** Providers de exemplo (Netflix por assinatura, Apple TV para aluguel). */
export function providersDetail(overrides: Partial<TmdbProviders> = {}): TmdbProviders {
  return {
    flatrate: [{ providerId: 8, providerName: 'Netflix', logoPath: '/netflix.jpg' }],
    rent: [{ providerId: 2, providerName: 'Apple TV', logoPath: '/apple.jpg' }],
    buy: [],
    link: 'https://www.themoviedb.org/tv/70523/watch?locale=BR',
    ...overrides,
  };
}

export interface FakeTmdbClient extends TmdbClient {
  /** Catálogo de títulos conhecidos (a chave é `MEDIA:tmdbId`). */
  add(...titles: TmdbTitleDetail[]): this;
  /** Faz toda chamada seguinte falhar com 503 `TMDB_UNAVAILABLE` (ou volta ao normal). */
  setDown(down: boolean): void;
  readonly searchCalls: { query: string; page: number }[];
  readonly popularCalls: number[];
  readonly getTitleCalls: { mediaType: TmdbMediaType; tmdbId: number }[];
  readonly getSeasonCalls: { tmdbId: number; season: number }[];
  readonly getProvidersCalls: { mediaType: TmdbMediaType; tmdbId: number }[];
  /** Registra uma temporada de `TV:tmdbId`. */
  addSeason(tmdbId: number, season: TmdbSeasonDetail): this;
  /** Registra os providers de `mediaType:tmdbId`. */
  addProviders(mediaType: TmdbMediaType, tmdbId: number, providers: TmdbProviders): this;
  reset(): void;
}

const SEARCH_PAGE_SIZE = 20;

/** TMDB fake em memória e injetável (`setTmdbClient`): nenhum teste chama o TMDB real. */
export function createFakeTmdb(): FakeTmdbClient {
  const catalog = new Map<string, TmdbTitleDetail>();
  let down = false;
  const searchCalls: { query: string; page: number }[] = [];
  const popularCalls: number[] = [];
  const getTitleCalls: { mediaType: TmdbMediaType; tmdbId: number }[] = [];
  const getSeasonCalls: { tmdbId: number; season: number }[] = [];
  const getProvidersCalls: { mediaType: TmdbMediaType; tmdbId: number }[] = [];
  const seasons = new Map<string, TmdbSeasonDetail>();
  const providers = new Map<string, TmdbProviders>();

  const unavailable = () => new AppError('TMDB_UNAVAILABLE');

  return {
    add(...titles) {
      for (const title of titles) catalog.set(`${title.mediaType}:${title.tmdbId}`, title);
      return this;
    },
    setDown(value) {
      down = value;
    },
    searchCalls,
    popularCalls,
    getTitleCalls,
    getSeasonCalls,
    getProvidersCalls,
    addSeason(tmdbId, season) {
      seasons.set(`${tmdbId}:${season.season}`, season);
      return this;
    },
    addProviders(mediaType, tmdbId, value) {
      providers.set(`${mediaType}:${tmdbId}`, value);
      return this;
    },
    reset() {
      catalog.clear();
      seasons.clear();
      providers.clear();
      getSeasonCalls.length = 0;
      getProvidersCalls.length = 0;
      down = false;
      searchCalls.length = 0;
      popularCalls.length = 0;
      getTitleCalls.length = 0;
    },
    getPopularMovies(): Promise<TmdbSearchPage> {
      popularCalls.push(1);
      if (down) return Promise.reject(unavailable());
      const movies = [...catalog.values()].filter((title) => title.mediaType === 'MOVIE');
      return Promise.resolve({
        page: 1,
        totalResults: movies.length,
        results: movies.slice(0, 20),
      });
    },
    search(query, page): Promise<TmdbSearchPage> {
      searchCalls.push({ query, page });
      if (down) return Promise.reject(unavailable());
      const needle = query.toLowerCase();
      const matches = [...catalog.values()].filter((title) =>
        title.name.toLowerCase().includes(needle),
      );
      const start = (page - 1) * SEARCH_PAGE_SIZE;
      return Promise.resolve({
        page,
        totalResults: matches.length,
        results: matches.slice(start, start + SEARCH_PAGE_SIZE).map((title) => ({
          tmdbId: title.tmdbId,
          mediaType: title.mediaType,
          name: title.name,
          overview: title.overview,
          posterPath: title.posterPath,
          releaseYear: title.releaseYear,
          genreIds: title.genreIds,
        })),
      });
    },
    getTitle(mediaType, tmdbId): Promise<TmdbTitleDetail> {
      getTitleCalls.push({ mediaType, tmdbId });
      if (down) return Promise.reject(unavailable());
      const title = catalog.get(`${mediaType}:${tmdbId}`);
      return title ? Promise.resolve(title) : Promise.reject(new AppError('TITLE_NOT_FOUND'));
    },
    getSeason(tmdbId, season): Promise<TmdbSeasonDetail> {
      getSeasonCalls.push({ tmdbId, season });
      if (down) return Promise.reject(unavailable());
      const found = seasons.get(`${tmdbId}:${season}`);
      return found ? Promise.resolve(found) : Promise.reject(new AppError('TITLE_NOT_FOUND'));
    },
    getProviders(mediaType, tmdbId): Promise<TmdbProviders> {
      getProvidersCalls.push({ mediaType, tmdbId });
      if (down) return Promise.reject(unavailable());
      const found = providers.get(`${mediaType}:${tmdbId}`);
      if (found) return Promise.resolve(found);
      if (!catalog.has(`${mediaType}:${tmdbId}`)) {
        return Promise.reject(new AppError('TITLE_NOT_FOUND'));
      }
      return Promise.resolve({ flatrate: [], rent: [], buy: [], link: null });
    },
  };
}
