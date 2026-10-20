import { UserSummary } from '../../openapi/common.js';
import { z } from '../../openapi/registry.js';

export const ProgressParams = z.object({ listId: z.uuid(), itemId: z.uuid() });

const position = z.coerce.number().int().min(1).max(100_000);

export const EpisodeParams = ProgressParams.extend({ season: position, episode: position });

export const WatchedEpisode = z
  .object({
    season: z.number().int().min(1),
    episode: z.number().int().min(1),
    watchedAt: z.iso.datetime(),
  })
  .openapi('WatchedEpisode');

export const EpisodePosition = z
  .object({ season: z.number().int().min(1), episode: z.number().int().min(1) })
  .openapi('EpisodePosition');

export const MemberProgress = z
  .object({
    member: UserSummary,
    current: EpisodePosition.nullable().openapi({
      description: 'Maior `(season, episode)` marcado; `null` sem progresso.',
    }),
    watchedCount: z.number().int().min(0),
    episodes: z
      .array(WatchedEpisode)
      .openapi({ description: 'Episódios marcados, em ordem de temporada e episódio.' }),
  })
  .openapi('MemberProgress');

export const ProgressList = z.object({ data: z.array(MemberProgress) }).openapi('ProgressList');

export type WatchedEpisode = z.infer<typeof WatchedEpisode>;
export type ProgressList = z.infer<typeof ProgressList>;
