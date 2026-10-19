import { AppError } from '../../http/app-error.js';
import type { Page } from '../../http/pagination.js';
import type { Title } from '../../generated/prisma/client.js';
import { prisma, Prisma } from '../../lib/prisma.js';
import { getTmdb, type TmdbMediaType, type TmdbTitleDetail } from '../../lib/tmdb/index.js';
import { SEARCH_PAGE_SIZE, type TitleDetail } from './titles.schemas.js';

/** Idade máxima da linha `Title` antes da atualização preguiçosa (RF-14, regra 5). */
export const TITLE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Cache em memória do detalhe completo (elenco e trailer não persistem). */
export const DETAIL_MEMORY_TTL_MS = 60 * 60 * 1000;

const memory = new Map<string, { at: number; detail: TmdbTitleDetail }>();

/** Zera o cache em memória (testes). */
export function clearTitleCache(): void {
  memory.clear();
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

export async function searchTitles(query: string, page: number): Promise<Page<TitleSummaryData>> {
  const result = await getTmdb().search(query, page);
  return {
    data: result.results.map(toTitleSummary),
    page,
    pageSize: SEARCH_PAGE_SIZE,
    total: result.totalResults,
  };
}

/** Detalhe do TMDB, com cache em memória; grava a resposta fresca na linha `Title` se ela já existe. */
async function fetchDetail(mediaType: TmdbMediaType, tmdbId: number): Promise<TmdbTitleDetail> {
  const key = `${mediaType}:${tmdbId}`;
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < DETAIL_MEMORY_TTL_MS) return hit.detail;
  const detail = await getTmdb().getTitle(mediaType, tmdbId);
  memory.set(key, { at: Date.now(), detail });
  return detail;
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
  };
}

/**
 * Detalhe do título (RF-13). TMDB primeiro (cache em memória de 1 h); com o TMDB
 * fora, serve a linha `Title` se existir (sem elenco e trailer), senão 503.
 */
export async function getTitleDetail(
  mediaType: TmdbMediaType,
  tmdbId: number,
): Promise<TitleDetail> {
  try {
    const detail = await fetchDetail(mediaType, tmdbId);
    if (await findRow(mediaType, tmdbId)) await saveTitle(detail);
    return detail;
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'TMDB_UNAVAILABLE') throw error;
    const row = await findRow(mediaType, tmdbId);
    if (!row) throw error;
    return detailFromRow(row);
  }
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
    return await saveTitle(await fetchDetail(mediaType, tmdbId));
  } catch (error) {
    if (row && error instanceof AppError && error.code === 'TMDB_UNAVAILABLE') return row;
    throw error;
  }
}
