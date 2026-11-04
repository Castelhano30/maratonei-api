import type { ListItem, ListMember, EpisodeProgress } from '../../src/generated/prisma/client.js';
import { prisma } from '../../src/lib/prisma.js';

/** Marca (ou mantém marcado) um episódio de um membro num item. */
export async function createEpisodeProgress(
  item: Pick<ListItem, 'id'>,
  member: Pick<ListMember, 'id'>,
  season: number,
  episode: number,
): Promise<EpisodeProgress> {
  return prisma.episodeProgress.upsert({
    where: {
      listItemId_memberId_season_episode: {
        listItemId: item.id,
        memberId: member.id,
        season,
        episode,
      },
    },
    create: { listItemId: item.id, memberId: member.id, season, episode },
    update: {},
  });
}
