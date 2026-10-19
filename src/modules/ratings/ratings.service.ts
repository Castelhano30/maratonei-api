import { prisma, type Prisma } from '../../lib/prisma.js';
import type { Rating, RatingList } from './ratings.schemas.js';

export interface RatingStats {
  average: number | null;
  count: number;
}

const ratingInclude = {
  member: { select: { user: { select: { id: true, name: true, image: true } } } },
} satisfies Prisma.RatingInclude;

type RatingRow = Prisma.RatingGetPayload<{ include: typeof ratingInclude }>;

function toRating(row: RatingRow): Rating {
  return { member: row.member.user, stars: row.stars, updatedAt: row.updatedAt.toISOString() };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Média (2 casas) e contagem das notas de cada item; item sem nota → `{average: null, count: 0}`. */
export async function ratingStatsByItem(itemIds: string[]): Promise<Map<string, RatingStats>> {
  const stats = new Map<string, RatingStats>(
    itemIds.map((id) => [id, { average: null, count: 0 }]),
  );
  if (itemIds.length === 0) return stats;
  const groups = await prisma.rating.groupBy({
    by: ['listItemId'],
    where: { listItemId: { in: itemIds } },
    _avg: { stars: true },
    _count: { _all: true },
  });
  for (const group of groups) {
    stats.set(group.listItemId, {
      average: group._avg.stars === null ? null : round2(group._avg.stars),
      count: group._count._all,
    });
  }
  return stats;
}

/** Nota de cada membro e a média (RF-19). Sem paginação: limitada por `MAX_LIST_MEMBERS`. */
export async function listRatings(itemId: string): Promise<RatingList> {
  const [rows, stats] = await Promise.all([
    prisma.rating.findMany({
      where: { listItemId: itemId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      include: ratingInclude,
    }),
    ratingStatsByItem([itemId]),
  ]);
  const { average, count } = stats.get(itemId) ?? { average: null, count: 0 };
  return { average, count, data: rows.map(toRating) };
}

/** Cria ou edita a nota do próprio membro (RF-18). */
export async function setOwnRating(
  itemId: string,
  memberId: string,
  stars: number,
): Promise<Rating> {
  const row = await prisma.rating.upsert({
    where: { listItemId_memberId: { listItemId: itemId, memberId } },
    create: { listItemId: itemId, memberId, stars },
    update: { stars },
    include: ratingInclude,
  });
  return toRating(row);
}

/** Remove a nota do próprio membro; idempotente. */
export async function removeOwnRating(itemId: string, memberId: string): Promise<void> {
  await prisma.rating.deleteMany({ where: { listItemId: itemId, memberId } });
}
