export type TmdbMediaType = 'MOVIE' | 'TV';

export interface TmdbTitleSummary {
  tmdbId: number;
  mediaType: TmdbMediaType;
  name: string;
  overview: string;
  posterPath: string | null;
  releaseYear: number | null;
  genreIds: number[];
}

export interface TmdbSearchPage {
  page: number;
  totalResults: number;
  results: TmdbTitleSummary[];
}

export interface TmdbGenre {
  id: number;
  name: string;
}

/** Item de listagem do TMDB (discover, now_playing). */
export interface TmdbCatalogItem {
  tmdbId: number;
  mediaType: TmdbMediaType;
  /** `title` do filme ou `name` da série; `''` se faltar. */
  title: string;
  /** De `release_date` ou `first_air_date`. */
  year: number | null;
  genreIds: number[];
  posterPath: string | null;
  /** Completo, sem truncar; `''` se faltar. */
  overview: string;
  /** Valor bruto do TMDB (0 a 10); `null` se ausente. */
  voteAverage: number | null;
  /** 0 se ausente. */
  voteCount: number;
  /** Séries: `origin_country[0]`; filmes: sempre `null`. */
  originCountry: string | null;
}

export interface TmdbCatalogPage {
  page: number;
  totalResults: number;
  totalPages: number;
  results: TmdbCatalogItem[];
}

export interface TmdbCastMember {
  name: string;
  character: string | null;
  profilePath: string | null;
}

export interface TmdbTrailer {
  site: 'YouTube';
  key: string;
  name: string;
}

export interface TmdbSeason {
  season: number;
  episodeCount: number;
}

export interface TmdbTitleDetail extends TmdbTitleSummary {
  genres: { id: number; name: string }[];
  /** Minutos (filmes). */
  runtime: number | null;
  /** Séries: número e total de episódios de cada temporada (sem especiais). */
  seasons: TmdbSeason[] | null;
  cast: TmdbCastMember[];
  trailer: TmdbTrailer | null;
  voteAverage: number | null;
  voteCount: number;
  /** Códigos ISO 3166-1 de `production_countries`. */
  productionCountries: string[];
  /** Séries: `number_of_seasons`; filmes: `null`. */
  numberOfSeasons: number | null;
}

export interface TmdbEpisode {
  episode: number;
  name: string;
  overview: string;
  /** `YYYY-MM-DD`. */
  airDate: string | null;
  /** Minutos. */
  runtime: number | null;
  stillPath: string | null;
}

export interface TmdbSeasonDetail {
  season: number;
  name: string;
  episodes: TmdbEpisode[];
}

export interface TmdbProvider {
  providerId: number;
  providerName: string;
  logoPath: string | null;
}

/** Onde assistir na região BR; sem dados → listas vazias e `link: null`. */
export interface TmdbProviders {
  flatrate: TmdbProvider[];
  rent: TmdbProvider[];
  buy: TmdbProvider[];
  link: string | null;
}

/**
 * Porta do TMDB. As implementações lançam `AppError`:
 * `TMDB_UNAVAILABLE` (sem chave, rede, timeout, 5xx, limite) e `TITLE_NOT_FOUND`.
 */
export interface TmdbClient {
  getPopularMovies(): Promise<TmdbSearchPage>;
  search(query: string, page: number): Promise<TmdbSearchPage>;
  getTitle(mediaType: TmdbMediaType, tmdbId: number): Promise<TmdbTitleDetail>;
  /** Temporada de uma série; inexistente → `TITLE_NOT_FOUND`. */
  getSeason(tmdbId: number, season: number): Promise<TmdbSeasonDetail>;
  /** Watch providers da região BR. */
  getProviders(mediaType: TmdbMediaType, tmdbId: number): Promise<TmdbProviders>;
  /** Filmes em cartaz na região BR. */
  getNowPlaying(page: number): Promise<TmdbCatalogPage>;
  /** `params` traz `page`, `sort_by`, `region`, `with_genres` etc. */
  discover(mediaType: TmdbMediaType, params: Record<string, string>): Promise<TmdbCatalogPage>;
  /** Gêneros do tipo, em pt-BR. */
  listGenres(mediaType: TmdbMediaType): Promise<TmdbGenre[]>;
  /** Busca restrita a um tipo. */
  searchByType(mediaType: TmdbMediaType, query: string, page: number): Promise<TmdbSearchPage>;
}
