import { randomInt } from 'node:crypto';
import type { Title } from '../../src/generated/prisma/client.js';
import { prisma } from '../../src/lib/prisma.js';

export interface CreateTitleInput {
  tmdbId?: number;
  mediaType?: 'MOVIE' | 'TV';
  name?: string;
  overview?: string;
  posterPath?: string | null;
  releaseYear?: number | null;
  genreIds?: number[];
  genres?: string[];
  runtime?: number | null;
  seasons?: { season: number; episodeCount: number }[];
  cachedAt?: Date;
}

/** Cria um `Title` global (cache do TMDB) com `tmdbId` aleatório quando omitido. */
export async function createTitle(input: CreateTitleInput = {}): Promise<Title> {
  const mediaType = input.mediaType ?? 'MOVIE';
  const tmdbId = input.tmdbId ?? randomInt(1_000_000, 2_000_000_000);
  const genreIds = input.genreIds ?? [];
  return prisma.title.create({
    data: {
      tmdbId,
      mediaType,
      name: input.name ?? `Título ${tmdbId}`,
      overview: input.overview ?? '',
      posterPath: input.posterPath ?? null,
      releaseYear: input.releaseYear ?? null,
      genreIds,
      genres: input.genres ?? genreIds.map((id) => `Gênero ${id}`),
      runtime: input.runtime ?? null,
      ...(input.seasons ? { seasons: input.seasons } : {}),
      ...(input.cachedAt ? { cachedAt: input.cachedAt } : {}),
    },
  });
}
