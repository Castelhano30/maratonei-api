import { AppError } from '../../src/http/app-error.js';
import type {
  TmdbClient,
  TmdbMediaType,
  TmdbSearchPage,
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

export interface FakeTmdbClient extends TmdbClient {
  /** Catálogo de títulos conhecidos (a chave é `MEDIA:tmdbId`). */
  add(...titles: TmdbTitleDetail[]): this;
  /** Faz toda chamada seguinte falhar com 503 `TMDB_UNAVAILABLE` (ou volta ao normal). */
  setDown(down: boolean): void;
  readonly searchCalls: { query: string; page: number }[];
  readonly getTitleCalls: { mediaType: TmdbMediaType; tmdbId: number }[];
  reset(): void;
}

const SEARCH_PAGE_SIZE = 20;

/** TMDB fake em memória e injetável (`setTmdbClient`): nenhum teste chama o TMDB real. */
export function createFakeTmdb(): FakeTmdbClient {
  const catalog = new Map<string, TmdbTitleDetail>();
  let down = false;
  const searchCalls: { query: string; page: number }[] = [];
  const getTitleCalls: { mediaType: TmdbMediaType; tmdbId: number }[] = [];

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
    getTitleCalls,
    reset() {
      catalog.clear();
      down = false;
      searchCalls.length = 0;
      getTitleCalls.length = 0;
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
  };
}
