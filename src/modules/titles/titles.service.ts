import { AppError } from '../../http/app-error.js';
import type { Page } from '../../http/pagination.js';
import type { Title } from '../../generated/prisma/client.js';
import {
  clearAllCaches,
  createCache,
  type GetOptions,
  DETAIL_TTL_MS,
  NEGATIVE_TTL_MS,
  PROVIDERS_TTL_MS,
  SEARCH_TTL_MS,
} from '../../lib/cache/index.js';
import { prisma, Prisma } from '../../lib/prisma.js';
import {
  getTmdb,
  toPublicRating,
  type TmdbMediaType,
  type TmdbProviders,
  type TmdbSearchPage,
  type TmdbSeasonDetail,
  type TmdbTitleDetail,
} from '../../lib/tmdb/index.js';
import { SEARCH_PAGE_SIZE, type TitleDetail } from './titles.schemas.js';

/** Idade máxima da linha `Title` antes da atualização preguiçosa. */
export const TITLE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RECOMMENDATIONS_MEMORY_TTL_MS = 60 * 60 * 1000;
/** Cache em memória de uma temporada (episódios não persistem). */
export const SEASON_MEMORY_TTL_MS = 60 * 60 * 1000;
/** Cache em memória dos provedores de streaming (não persistem). */
export const PROVIDERS_MEMORY_TTL_MS = PROVIDERS_TTL_MS;

export { NEGATIVE_TTL_MS };

/**
 * Detalhe completo (elenco e trailer não persistem) e provedores servem a cópia vencida
 * se o TMDB falhar (rotas públicas, AD-19). Recomendações e temporadas seguem sem isso.
 */
const detailCache = createCache<TmdbTitleDetail>({ ttlMs: DETAIL_TTL_MS, staleIfError: true });
const searchCache = createCache<TmdbSearchPage>({ ttlMs: SEARCH_TTL_MS, staleIfError: true });
const recommendationsCache = createCache<TmdbSearchPage>({ ttlMs: RECOMMENDATIONS_MEMORY_TTL_MS });
const seasonCache = createCache<TmdbSeasonDetail>({ ttlMs: SEASON_MEMORY_TTL_MS });
const providersCache = createCache<TmdbProviders>({ ttlMs: PROVIDERS_TTL_MS, staleIfError: true });

/** Esvazia todos os caches em memória (testes). */
export function clearTitleCache(): void {
  clearAllCaches();
}

/** Episódios de uma temporada;temporada inexistente → 404 `TITLE_NOT_FOUND`. */
export function getSeason(tmdbId: number, season: number): Promise<TmdbSeasonDetail> {
  return seasonCache.get(`${tmdbId}:${season}`, () => getTmdb().getSeason(tmdbId, season));
}

/** Onde assistir no Brasil, com cache de 24 h. */
export function getProviders(mediaType: TmdbMediaType, tmdbId: number): Promise<TmdbProviders> {
  return providersCache.get(`${mediaType}:${tmdbId}`, () =>
    getTmdb().getProviders(mediaType, tmdbId),
  );
}

export interface TitleSummaryData {
  tmdbId: number;
  mediaType: TmdbMediaType;
  name: string;
  overview: string;
  posterPath: string | null;
  releaseYear: number | null;
  genreIds: number[];
}

export function toTitleSummary(title: TitleSummaryData): TitleSummaryData {
  return {
    tmdbId: title.tmdbId,
    mediaType: title.mediaType,
    name: title.name,
    overview: title.overview,
    posterPath: title.posterPath,
    releaseYear: title.releaseYear,
    genreIds: title.genreIds,
  };
}

export async function searchTitles(
  query: string,
  page: number,
  mediaType?: TmdbMediaType,
): Promise<Page<TitleSummaryData>> {
  const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, ' ');
  const key = JSON.stringify([mediaType ?? 'ALL', normalizedQuery, page]);
  const result = await searchCache.get(key, async () => {
    try {
      return await (mediaType
        ? getTmdb().searchByType(mediaType, normalizedQuery, page)
        : getTmdb().search(normalizedQuery, page));
    } catch (error) {
      // Um 404 do TMDB numa busca é falha do TMDB, não "título inexistente".
      if (error instanceof AppError && error.code === 'TITLE_NOT_FOUND') {
        throw new AppError('TMDB_UNAVAILABLE', { cause: error });
      }
      throw error;
    }
  });
  return {
    data: result.results.map(toTitleSummary),
    page,
    pageSize: SEARCH_PAGE_SIZE,
    total: result.totalResults,
  };
}

/** Filmes populares no Brasil; somente cache em memória, sem persistir títulos. */
export async function getTitleRecommendations(): Promise<Page<TitleSummaryData>> {
  const result = await recommendationsCache.get('popular:pt-BR:BR:1', async () => {
    try {
      return await getTmdb().getPopularMovies();
    } catch {
      throw new AppError('TMDB_UNAVAILABLE');
    }
  });
  return {
    data: result.results.map(toTitleSummary),
    page: 1,
    pageSize: SEARCH_PAGE_SIZE,
    total: result.totalResults,
  };
}

/** Caminhos que gravam no banco nunca persistem a cópia vencida do cache. */
const NO_STALE: GetOptions = { allowStale: false };

/** Detalhe do TMDB, com cache em memória e chamadas simultâneas deduplicadas. */
export function fetchDetail(
  mediaType: TmdbMediaType,
  tmdbId: number,
  options?: GetOptions,
): Promise<TmdbTitleDetail> {
  return detailCache.get(
    `${mediaType}:${tmdbId}`,
    () => getTmdb().getTitle(mediaType, tmdbId),
    options,
  );
}

function rowData(detail: TmdbTitleDetail) {
  return {
    name: detail.name,
    overview: detail.overview,
    posterPath: detail.posterPath,
    releaseYear: detail.releaseYear,
    genreIds: detail.genres.map((genre) => genre.id),
    genres: detail.genres.map((genre) => genre.name),
    runtime: detail.runtime,
    seasons: detail.seasons
      ? detail.seasons.map((s) => ({ season: s.season, episodeCount: s.episodeCount }))
      : Prisma.DbNull,
    cachedAt: new Date(),
  };
}

async function saveTitle(detail: TmdbTitleDetail): Promise<Title> {
  const data = rowData(detail);
  return prisma.title.upsert({
    where: { mediaType_tmdbId: { mediaType: detail.mediaType, tmdbId: detail.tmdbId } },
    create: { mediaType: detail.mediaType, tmdbId: detail.tmdbId, ...data },
    update: data,
  });
}

function findRow(mediaType: TmdbMediaType, tmdbId: number): Promise<Title | null> {
  return prisma.title.findUnique({ where: { mediaType_tmdbId: { mediaType, tmdbId } } });
}

function seasonsOf(row: Title): TitleDetail['seasons'] {
  if (row.mediaType !== 'TV' || !Array.isArray(row.seasons)) return null;
  return row.seasons as TitleDetail['seasons'];
}

function detailFromRow(row: Title): TitleDetail {
  return {
    ...toTitleSummary(row),
    genres: row.genreIds.map((id, index) => ({ id, name: row.genres[index] ?? '' })),
    runtime: row.runtime,
    seasons: seasonsOf(row),
    cast: [],
    trailer: null,
    voteAverage: null,
    voteCount: 0,
  };
}

export interface TitleDetailResult {
  detail: TitleDetail;
  /** Cópia reduzida da linha `Title` (TMDB fora e sem cópia em memória): não deve ficar em cache público. */
  degraded: boolean;
}

/**
 * Detalhe do título para a rota pública, somente leitura. TMDB primeiro (cache em memória de 1 h,
 * com cópia vencida por até 24 h se o TMDB falhar); depois a linha `Title`, sem elenco e
 * trailer e marcada como degradada; senão 503.
 */
export async function getTitleDetailResult(
  mediaType: TmdbMediaType,
  tmdbId: number,
): Promise<TitleDetailResult> {
  try {
    const detail = await fetchDetail(mediaType, tmdbId);
    return {
      degraded: false,
      detail: {
        ...toTitleSummary(detail),
        genres: detail.genres,
        runtime: detail.runtime,
        seasons: detail.seasons,
        cast: detail.cast,
        trailer: detail.trailer,
        voteAverage: toPublicRating(detail.voteAverage, detail.voteCount),
        voteCount: detail.voteCount,
      },
    };
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'TMDB_UNAVAILABLE') throw error;
    const row = await findRow(mediaType, tmdbId);
    if (!row) throw error;
    return { degraded: true, detail: detailFromRow(row) };
  }
}

export async function getTitleDetail(
  mediaType: TmdbMediaType,
  tmdbId: number,
): Promise<TitleDetail> {
  return (await getTitleDetailResult(mediaType, tmdbId)).detail;
}

/**
 * Garante a linha global `Title` (criada na primeira adição; atualizada de forma
 * preguiçosa após `TITLE_CACHE_TTL`). Linha existente sobrevive a falha do TMDB;
 * sem linha e com TMDB fora → 503.
 */
export async function ensureTitle(mediaType: TmdbMediaType, tmdbId: number): Promise<Title> {
  const row = await findRow(mediaType, tmdbId);
  if (row && Date.now() - row.cachedAt.getTime() < TITLE_CACHE_TTL_MS) return row;
  try {
    return await saveTitle(await fetchDetail(mediaType, tmdbId, NO_STALE));
  } catch (error) {
    if (row && error instanceof AppError && error.code === 'TMDB_UNAVAILABLE') return row;
    throw error;
  }
}

/**
 * Atualiza a linha `Title` agora, sem esperar o TTL (ex.: episódio recém-lançado).
 * Usa o detalhe em cache de memória; com o TMDB fora ou o título removido, mantém a linha.
 */
export async function refreshTitle(mediaType: TmdbMediaType, tmdbId: number): Promise<void> {
  try {
    await saveTitle(await fetchDetail(mediaType, tmdbId, NO_STALE));
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
  }
}
