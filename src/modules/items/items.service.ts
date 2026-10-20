import { z } from 'zod';
import { AppError } from '../../http/app-error.js';
import { pageArgs, toPage, type Page } from '../../http/pagination.js';
import type { ItemStatus } from '../../generated/prisma/client.js';
import { prisma, Prisma } from '../../lib/prisma.js';
import { ratingStatsByItem, type RatingStats } from '../ratings/index.js';
import { ensureTitle, refreshTitle, toTitleSummary } from '../titles/index.js';
import type { AddItemBody, ItemsQuery, ListItem, RandomQuery } from './items.schemas.js';

const itemInclude = {
  title: true,
  addedBy: { select: { id: true, name: true, image: true } },
} satisfies Prisma.ListItemInclude;

type ItemRow = Prisma.ListItemGetPayload<{ include: typeof itemInclude }>;

const NO_RATINGS: RatingStats = { average: null, count: 0 };

function toListItem(row: ItemRow, stats: RatingStats = NO_RATINGS): ListItem {
  return {
    id: row.id,
    title: toTitleSummary(row.title),
    status: row.status,
    addedBy: row.addedBy,
    addedAt: row.addedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ratingAverage: stats.average,
    ratingCount: stats.count,
  };
}

export interface StatusCounts {
  WANT: number;
  WATCHING: number;
  WATCHED: number;
}

/** Itens da lista por status (0 quando vazio); alimenta as abas da lista. */
export async function countItemsByStatus(listId: string): Promise<StatusCounts> {
  const groups = await prisma.listItem.groupBy({
    by: ['status'],
    where: { listId },
    _count: { _all: true },
  });
  const counts: StatusCounts = { WANT: 0, WATCHING: 0, WATCHED: 0 };
  for (const group of groups) counts[group.status] = group._count._all;
  return counts;
}

async function statsOf(itemId: string): Promise<RatingStats> {
  return (await ratingStatsByItem([itemId])).get(itemId) ?? NO_RATINGS;
}

export async function listItems(listId: string, query: ItemsQuery): Promise<Page<ListItem>> {
  const where: Prisma.ListItemWhereInput = {
    listId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.mediaType || query.genreId !== undefined
      ? {
          title: {
            ...(query.mediaType ? { mediaType: query.mediaType } : {}),
            ...(query.genreId !== undefined ? { genreIds: { has: query.genreId } } : {}),
          },
        }
      : {}),
  };
  const direction = query.sort === 'addedAt:asc' ? 'asc' : 'desc';
  const [rows, total] = await Promise.all([
    prisma.listItem.findMany({
      where,
      orderBy: [{ addedAt: direction }, { id: direction }],
      ...pageArgs(query),
      include: itemInclude,
    }),
    prisma.listItem.count({ where }),
  ]);
  const stats = await ratingStatsByItem(rows.map((row) => row.id));
  return toPage(
    rows.map((row) => toListItem(row, stats.get(row.id))),
    total,
    query,
  );
}

/**
 * Sorteio "O que assistir hoje?" (RF-27): um item `WANT` ao acaso, opcionalmente
 * de um tipo; sem pendentes → `null`.
 */
export async function randomItem(
  listId: string,
  query: RandomQuery,
): Promise<{ data: ListItem | null }> {
  const where: Prisma.ListItemWhereInput = {
    listId,
    status: 'WANT',
    ...(query.mediaType ? { title: { mediaType: query.mediaType } } : {}),
  };
  const total = await prisma.listItem.count({ where });
  if (total === 0) return { data: null };
  const pick = (skip: number) =>
    prisma.listItem.findFirst({ where, orderBy: { id: 'asc' }, skip, include: itemInclude });
  // Itens podem ter saído entre a contagem e a busca: sem resultado, tenta o primeiro.
  const row = (await pick(Math.floor(Math.random() * total))) ?? (await pick(0));
  if (!row) return { data: null };
  return { data: toListItem(row, await statsOf(row.id)) };
}

export interface ItemTitleRef {
  mediaType: 'MOVIE' | 'TV';
  tmdbId: number;
  /** `Title.seasons` persistido (séries); `null` quando desconhecido. */
  seasons: { season: number; episodeCount: number }[] | null;
}

const SeasonsSchema = z.array(
  z.object({ season: z.number().int().min(0), episodeCount: z.number().int().min(0) }),
);

/** `Title.seasons` é JSON livre no banco: formato inesperado conta como desconhecido (`null`). */
function parseSeasons(value: unknown): ItemTitleRef['seasons'] {
  const parsed = SeasonsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Tipo, id do TMDB e temporadas do título do item (para o módulo `progress`). Com `refresh`,
 * atualiza antes a linha `Title` a partir do TMDB (falha do TMDB mantém o que está salvo).
 */
export async function getItemTitleRef(
  listId: string,
  itemId: string,
  options: { refresh?: boolean } = {},
): Promise<ItemTitleRef> {
  if (options.refresh) {
    const current = await getItemTitleRef(listId, itemId);
    if (current.mediaType === 'TV') await refreshTitle(current.mediaType, current.tmdbId);
  }
  const row = await prisma.listItem.findFirst({
    where: { id: itemId, listId },
    select: { title: { select: { mediaType: true, tmdbId: true, seasons: true } } },
  });
  if (!row) throw new AppError('ITEM_NOT_FOUND');
  const { mediaType, tmdbId, seasons } = row.title;
  return {
    mediaType,
    tmdbId,
    seasons: mediaType === 'TV' ? parseSeasons(seasons) : null,
  };
}

export async function getItem(listId: string, itemId: string): Promise<ListItem> {
  const row = await prisma.listItem.findFirst({
    where: { id: itemId, listId },
    include: itemInclude,
  });
  if (!row) throw new AppError('ITEM_NOT_FOUND');
  return toListItem(row, await statsOf(row.id));
}

/**
 * Adiciona o título à lista (RF-14). Duplicado (checado antes de chamar o TMDB
 * e garantido pela unique `(listId, titleId)`) → 409 `TITLE_ALREADY_IN_LIST`.
 */
export async function addItem(
  listId: string,
  userId: string,
  body: AddItemBody,
): Promise<ListItem> {
  const duplicate = await prisma.listItem.findFirst({
    where: { listId, title: { mediaType: body.mediaType, tmdbId: body.tmdbId } },
    select: { id: true },
  });
  if (duplicate) throw new AppError('TITLE_ALREADY_IN_LIST');

  const title = await ensureTitle(body.mediaType, body.tmdbId);
  const row = await prisma.listItem.create({
    data: { listId, titleId: title.id, addedById: userId },
    include: itemInclude,
  });
  return toListItem(row);
}

export async function removeItem(listId: string, itemId: string): Promise<void> {
  const { count } = await prisma.listItem.deleteMany({ where: { id: itemId, listId } });
  if (count === 0) throw new AppError('ITEM_NOT_FOUND');
}

/** Status coletivo: a última escrita prevalece (regra 11). */
export async function setItemStatus(
  listId: string,
  itemId: string,
  status: ItemStatus,
): Promise<ListItem> {
  try {
    const row = await prisma.listItem.update({
      where: { id: itemId, listId },
      data: { status },
      include: itemInclude,
    });
    return toListItem(row, await statsOf(row.id));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new AppError('ITEM_NOT_FOUND');
    }
    throw error;
  }
}
