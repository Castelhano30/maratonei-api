import { AppError } from '../../http/app-error.js';
import { pageArgs, toPage, type Page } from '../../http/pagination.js';
import type { ItemStatus } from '../../generated/prisma/client.js';
import { prisma, Prisma } from '../../lib/prisma.js';
import { ensureTitle, toTitleSummary } from '../titles/index.js';
import type { AddItemBody, ItemsQuery, ListItem } from './items.schemas.js';

const itemInclude = {
  title: true,
  addedBy: { select: { id: true, name: true, image: true } },
} satisfies Prisma.ListItemInclude;

type ItemRow = Prisma.ListItemGetPayload<{ include: typeof itemInclude }>;

function toListItem(row: ItemRow): ListItem {
  return {
    id: row.id,
    title: toTitleSummary(row.title),
    status: row.status,
    addedBy: row.addedBy,
    addedAt: row.addedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    // Notas chegam na Fase 5 (`Rating`); até lá, sem notas.
    ratingAverage: null,
    ratingCount: 0,
  };
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
  return toPage(rows.map(toListItem), total, query);
}

export async function getItem(listId: string, itemId: string): Promise<ListItem> {
  const row = await prisma.listItem.findFirst({
    where: { id: itemId, listId },
    include: itemInclude,
  });
  if (!row) throw new AppError('ITEM_NOT_FOUND');
  return toListItem(row);
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
    return toListItem(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new AppError('ITEM_NOT_FOUND');
    }
    throw error;
  }
}
