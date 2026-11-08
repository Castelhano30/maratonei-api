import { AppError } from '../../src/http/app-error.js';
import type {
  TmdbCatalogItem,
  TmdbCatalogPage,
  TmdbClient,
  TmdbGenre,
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
    voteAverage: 7.8,
    voteCount: 12000,
    productionCountries: ['US'],
    numberOfSeasons: null,
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
    voteAverage: 8.7,
    voteCount: 5000,
    productionCountries: ['DE'],
    numberOfSeasons: 3,
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

let nextCatalogItemId = 100_000;

/** Item de listagem de exemplo (filme por padrão); sem `tmdbId`, gera ids crescentes. */
export function catalogItem(overrides: Partial<TmdbCatalogItem> = {}): TmdbCatalogItem {
  const tmdbId = overrides.tmdbId ?? nextCatalogItemId++;
  const isMovie = (overrides.mediaType ?? 'MOVIE') === 'MOVIE';
  return {
    mediaType: 'MOVIE',
    title: `${isMovie ? 'Filme' : 'Série'} ${tmdbId}`,
    year: 2021,
    genreIds: [18],
    posterPath: `/poster-${tmdbId}.jpg`,
    overview: `Sinopse do título ${tmdbId}.`,
    voteAverage: 7.5,
    voteCount: 1000,
    originCountry: isMovie ? null : 'DE',
    ...overrides,
    tmdbId,
  };
}

/** `count` itens de listagem do tipo pedido, com ids únicos. */
export function catalogItems(
  mediaType: TmdbMediaType,
  count: number,
  overrides: Partial<TmdbCatalogItem> = {},
): TmdbCatalogItem[] {
  return Array.from({ length: count }, () => catalogItem({ ...overrides, mediaType }));
}

export interface FakeTmdbClient extends TmdbClient {
  /** Catálogo de títulos conhecidos (a chave é `MEDIA:tmdbId`). */
  add(...titles: TmdbTitleDetail[]): this;
  /** Itens de listagem que `discover` filtra, ordena e pagina. */
  addCatalogItems(...items: TmdbCatalogItem[]): this;
  /** Define a lista inteira de `getNowPlaying`. */
  setNowPlaying(items: TmdbCatalogItem[]): this;
  /** Define os gêneros de `listGenres` para o tipo. */
  setGenres(mediaType: TmdbMediaType, genres: TmdbGenre[]): this;
  /**
   * Sem `only`: toda chamada seguinte falha com 503 `TMDB_UNAVAILABLE` (ou volta ao normal).
   * `setDown(true, only)`: falham apenas esses métodos, substituindo o estado anterior.
   * `setDown(false, only)`: esses métodos voltam ao normal.
   */
  setDown(down: boolean, only?: readonly (keyof TmdbClient)[]): void;
  readonly searchCalls: { query: string; page: number }[];
  readonly popularCalls: number[];
  readonly getTitleCalls: { mediaType: TmdbMediaType; tmdbId: number }[];
  readonly getSeasonCalls: { tmdbId: number; season: number }[];
  readonly getProvidersCalls: { mediaType: TmdbMediaType; tmdbId: number }[];
  readonly discoverCalls: { mediaType: TmdbMediaType; params: Record<string, string> }[];
  readonly nowPlayingCalls: number[];
  readonly listGenresCalls: TmdbMediaType[];
  readonly searchByTypeCalls: { mediaType: TmdbMediaType; query: string; page: number }[];
  /** Total de chamadas de todos os métodos do TMDB, inclusive as que falharam. */
  callCount(): number;
  /** Registra uma temporada de `TV:tmdbId`. */
  addSeason(tmdbId: number, season: TmdbSeasonDetail): this;
  /** Registra os providers de `mediaType:tmdbId`. */
  addProviders(mediaType: TmdbMediaType, tmdbId: number, providers: TmdbProviders): this;
  reset(): void;
}

const PAGE_SIZE = 20;

const ALL_METHODS = Object.keys({
  getPopularMovies: true,
  search: true,
  getTitle: true,
  getSeason: true,
  getProviders: true,
  getNowPlaying: true,
  discover: true,
  listGenres: true,
  searchByType: true,
} satisfies Record<keyof TmdbClient, true>) as (keyof TmdbClient)[];

/** Ordem decrescente com `null` por último. */
function descNullsLast(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

function sortCatalog(items: TmdbCatalogItem[], sortBy: string | undefined): TmdbCatalogItem[] {
  switch (sortBy) {
    case 'vote_average.desc':
      return items.toSorted((a, b) => descNullsLast(a.voteAverage, b.voteAverage));
    case 'primary_release_date.desc':
    case 'first_air_date.desc':
      return items.toSorted((a, b) => descNullsLast(a.year, b.year));
    default:
      return items;
  }
}

function catalogPage(items: TmdbCatalogItem[], page: number): TmdbCatalogPage {
  const start = (page - 1) * PAGE_SIZE;
  return {
    page,
    totalResults: items.length,
    totalPages: Math.ceil(items.length / PAGE_SIZE),
    results: items.slice(start, start + PAGE_SIZE),
  };
}

function searchPage(matches: TmdbTitleDetail[], page: number): TmdbSearchPage {
  const start = (page - 1) * PAGE_SIZE;
  return {
    page,
    totalResults: matches.length,
    results: matches.slice(start, start + PAGE_SIZE).map((title) => ({
      tmdbId: title.tmdbId,
      mediaType: title.mediaType,
      name: title.name,
      overview: title.overview,
      posterPath: title.posterPath,
      releaseYear: title.releaseYear,
      genreIds: title.genreIds,
    })),
  };
}

/** TMDB fake em memória e injetável (`setTmdbClient`): nenhum teste chama o TMDB real. */
export function createFakeTmdb(): FakeTmdbClient {
  const catalog = new Map<string, TmdbTitleDetail>();
  const catalogListing: TmdbCatalogItem[] = [];
  let nowPlaying: TmdbCatalogItem[] = [];
  const genres = new Map<TmdbMediaType, TmdbGenre[]>();
  let down = new Set<keyof TmdbClient>();
  const searchCalls: { query: string; page: number }[] = [];
  const popularCalls: number[] = [];
  const getTitleCalls: { mediaType: TmdbMediaType; tmdbId: number }[] = [];
  const getSeasonCalls: { tmdbId: number; season: number }[] = [];
  const getProvidersCalls: { mediaType: TmdbMediaType; tmdbId: number }[] = [];
  const seasons = new Map<string, TmdbSeasonDetail>();
  const providers = new Map<string, TmdbProviders>();
  const discoverCalls: { mediaType: TmdbMediaType; params: Record<string, string> }[] = [];
  const nowPlayingCalls: number[] = [];
  const listGenresCalls: TmdbMediaType[] = [];
  const searchByTypeCalls: { mediaType: TmdbMediaType; query: string; page: number }[] = [];

  const unavailable = () => new AppError('TMDB_UNAVAILABLE');

  return {
    add(...titles) {
      for (const title of titles) catalog.set(`${title.mediaType}:${title.tmdbId}`, title);
      return this;
    },
    addCatalogItems(...items) {
      catalogListing.push(...items);
      return this;
    },
    setNowPlaying(items) {
      nowPlaying = [...items];
      return this;
    },
    setGenres(mediaType, list) {
      genres.set(mediaType, [...list]);
      return this;
    },
    setDown(value, only) {
      if (only === undefined) {
        down = new Set(value ? ALL_METHODS : []);
      } else if (value) {
        down = new Set(only);
      } else {
        for (const method of only) down.delete(method);
      }
    },
    searchCalls,
    popularCalls,
    getTitleCalls,
    getSeasonCalls,
    getProvidersCalls,
    discoverCalls,
    nowPlayingCalls,
    listGenresCalls,
    searchByTypeCalls,
    callCount() {
      return (
        searchCalls.length +
        popularCalls.length +
        getTitleCalls.length +
        getSeasonCalls.length +
        getProvidersCalls.length +
        discoverCalls.length +
        nowPlayingCalls.length +
        listGenresCalls.length +
        searchByTypeCalls.length
      );
    },
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
      catalogListing.length = 0;
      nowPlaying = [];
      genres.clear();
      seasons.clear();
      providers.clear();
      getSeasonCalls.length = 0;
      getProvidersCalls.length = 0;
      discoverCalls.length = 0;
      nowPlayingCalls.length = 0;
      listGenresCalls.length = 0;
      searchByTypeCalls.length = 0;
      down = new Set();
      searchCalls.length = 0;
      popularCalls.length = 0;
      getTitleCalls.length = 0;
    },
    getPopularMovies(): Promise<TmdbSearchPage> {
      popularCalls.push(1);
      if (down.has('getPopularMovies')) return Promise.reject(unavailable());
      const movies = [...catalog.values()].filter((title) => title.mediaType === 'MOVIE');
      return Promise.resolve({
        page: 1,
        totalResults: movies.length,
        results: movies.slice(0, 20),
      });
    },
    search(query, page): Promise<TmdbSearchPage> {
      searchCalls.push({ query, page });
      if (down.has('search')) return Promise.reject(unavailable());
      const needle = query.toLowerCase();
      const matches = [...catalog.values()].filter((title) =>
        title.name.toLowerCase().includes(needle),
      );
      return Promise.resolve(searchPage(matches, page));
    },
    searchByType(mediaType, query, page): Promise<TmdbSearchPage> {
      searchByTypeCalls.push({ mediaType, query, page });
      if (down.has('searchByType')) return Promise.reject(unavailable());
      const needle = query.toLowerCase();
      const matches = [...catalog.values()].filter(
        (title) => title.mediaType === mediaType && title.name.toLowerCase().includes(needle),
      );
      return Promise.resolve(searchPage(matches, page));
    },
    getTitle(mediaType, tmdbId): Promise<TmdbTitleDetail> {
      getTitleCalls.push({ mediaType, tmdbId });
      if (down.has('getTitle')) return Promise.reject(unavailable());
      const title = catalog.get(`${mediaType}:${tmdbId}`);
      return title ? Promise.resolve(title) : Promise.reject(new AppError('TITLE_NOT_FOUND'));
    },
    getSeason(tmdbId, season): Promise<TmdbSeasonDetail> {
      getSeasonCalls.push({ tmdbId, season });
      if (down.has('getSeason')) return Promise.reject(unavailable());
      const found = seasons.get(`${tmdbId}:${season}`);
      return found ? Promise.resolve(found) : Promise.reject(new AppError('TITLE_NOT_FOUND'));
    },
    getProviders(mediaType, tmdbId): Promise<TmdbProviders> {
      getProvidersCalls.push({ mediaType, tmdbId });
      if (down.has('getProviders')) return Promise.reject(unavailable());
      const found = providers.get(`${mediaType}:${tmdbId}`);
      if (found) return Promise.resolve(found);
      if (!catalog.has(`${mediaType}:${tmdbId}`)) {
        return Promise.reject(new AppError('TITLE_NOT_FOUND'));
      }
      return Promise.resolve({ flatrate: [], rent: [], buy: [], link: null });
    },
    getNowPlaying(page): Promise<TmdbCatalogPage> {
      nowPlayingCalls.push(page);
      if (down.has('getNowPlaying')) return Promise.reject(unavailable());
      return Promise.resolve(catalogPage(nowPlaying, page));
    },
    discover(mediaType, params): Promise<TmdbCatalogPage> {
      discoverCalls.push({ mediaType, params: { ...params } });
      if (down.has('discover')) return Promise.reject(unavailable());
      const genre = params['with_genres'];
      const minVotes = params['vote_count.gte'];
      const matches = catalogListing.filter(
        (item) =>
          item.mediaType === mediaType &&
          (genre === undefined || item.genreIds.includes(Number(genre))) &&
          (minVotes === undefined || item.voteCount >= Number(minVotes)),
      );
      return Promise.resolve(
        catalogPage(sortCatalog(matches, params['sort_by']), Number(params['page'] ?? 1)),
      );
    },
    listGenres(mediaType): Promise<TmdbGenre[]> {
      listGenresCalls.push(mediaType);
      if (down.has('listGenres')) return Promise.reject(unavailable());
      return Promise.resolve([...(genres.get(mediaType) ?? [])]);
    },
  };
}
