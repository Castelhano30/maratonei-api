import { AppError } from '../../http/app-error.js';
import { prisma, Prisma } from '../../lib/prisma.js';
import { getItemTitleRef, type ItemTitleRef } from '../items/index.js';
import type { ProgressList, WatchedEpisode } from './progress.schemas.js';

/** O progresso só vale para séries (regra 12); devolve as temporadas conhecidas. */
async function seriesOf(listId: string, itemId: string): Promise<ItemTitleRef> {
  const ref = await getItemTitleRef(listId, itemId);
  if (ref.mediaType !== 'TV') throw new AppError('NOT_A_SERIES');
  return ref;
}

/** Episódio dentro de `Title.seasons`; sem `seasons` conhecido, qualquer inteiro positivo vale. */
function assertEpisodeExists(ref: ItemTitleRef, season: number, episode: number): void {
  if (!ref.seasons || ref.seasons.length === 0) return;
  const found = ref.seasons.find((s) => s.season === season);
  if (!found) {
    throw new AppError('VALIDATION_FAILED', {
      errors: [{ field: 'season', message: 'A série não tem essa temporada.' }],
    });
  }
  if (episode > found.episodeCount) {
    throw new AppError('VALIDATION_FAILED', {
      errors: [{ field: 'episode', message: 'A temporada não tem esse episódio.' }],
    });
  }
}

/** Progresso de cada membro da lista, em ordem de entrada (RF-21..RF-23). */
export async function listProgress(listId: string, itemId: string): Promise<ProgressList> {
  await seriesOf(listId, itemId);
  const [members, rows] = await Promise.all([
    prisma.listMember.findMany({
      where: { listId },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      select: { id: true, user: { select: { id: true, name: true, image: true } } },
    }),
    prisma.episodeProgress.findMany({
      where: { listItemId: itemId },
      orderBy: [{ season: 'asc' }, { episode: 'asc' }],
    }),
  ]);
  return {
    data: members.map((member) => {
      const episodes = rows
        .filter((row) => row.memberId === member.id)
        .map((row) => ({
          season: row.season,
          episode: row.episode,
          watchedAt: row.watchedAt.toISOString(),
        }));
      const last = episodes.at(-1);
      return {
        member: member.user,
        current: last ? { season: last.season, episode: last.episode } : null,
        watchedCount: episodes.length,
        episodes,
      };
    }),
  };
}

/** Marca o episódio para o próprio membro; idempotente (mantém o `watchedAt` original). */
export async function markEpisode(
  listId: string,
  itemId: string,
  memberId: string,
  season: number,
  episode: number,
): Promise<WatchedEpisode> {
  const ref = await seriesOf(listId, itemId);
  assertEpisodeExists(ref, season, episode);
  const key = { listItemId: itemId, memberId, season, episode };
  let row;
  try {
    row = await prisma.episodeProgress.upsert({
      where: { listItemId_memberId_season_episode: key },
      create: key,
      update: {},
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
    if (error.code === 'P2002') {
      // Duas marcações simultâneas do mesmo episódio: a outra venceu o create.
      row = await prisma.episodeProgress.findUniqueOrThrow({
        where: { listItemId_memberId_season_episode: key },
      });
    } else if (error.code === 'P2003') {
      // Membro ou item saiu entre a checagem de acesso e a gravação.
      throw new AppError('LIST_NOT_FOUND');
    } else {
      throw error;
    }
  }
  return { season: row.season, episode: row.episode, watchedAt: row.watchedAt.toISOString() };
}

/** Desmarca o episódio do próprio membro; idempotente. */
export async function unmarkEpisode(
  listId: string,
  itemId: string,
  memberId: string,
  season: number,
  episode: number,
): Promise<void> {
  await seriesOf(listId, itemId);
  await prisma.episodeProgress.deleteMany({
    where: { listItemId: itemId, memberId, season, episode },
  });
}
