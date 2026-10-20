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
 * Porta do TMDB (AD-11). As implementações lançam `AppError`:
 * `TMDB_UNAVAILABLE` (sem chave, rede, timeout, 5xx, limite) e `TITLE_NOT_FOUND`.
 */
export interface TmdbClient {
  search(query: string, page: number): Promise<TmdbSearchPage>;
  getTitle(mediaType: TmdbMediaType, tmdbId: number): Promise<TmdbTitleDetail>;
  /** Temporada de uma série; inexistente → `TITLE_NOT_FOUND`. */
  getSeason(tmdbId: number, season: number): Promise<TmdbSeasonDetail>;
  /** Watch providers da região BR. */
  getProviders(mediaType: TmdbMediaType, tmdbId: number): Promise<TmdbProviders>;
}
