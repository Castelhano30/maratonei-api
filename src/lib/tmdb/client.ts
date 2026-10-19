import { z } from 'zod';
import { AppError } from '../../http/app-error.js';
import type {
  TmdbClient,
  TmdbMediaType,
  TmdbSearchPage,
  TmdbTitleDetail,
  TmdbTitleSummary,
  TmdbTrailer,
} from './types.js';

export const DEFAULT_TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const LANGUAGE = 'pt-BR';
const CAST_LIMIT = 10;

export interface HttpTmdbClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Timeout de cada tentativa. */
  timeoutMs?: number;
  /** Pausa antes da única retentativa. */
  retryDelayMs?: number;
  fetch?: typeof fetch;
}

const nullableString = z.string().nullish();
const genreSchema = z.object({ id: z.number().int(), name: z.string() });

const searchResultSchema = z.object({
  id: z.number().int(),
  media_type: z.string(),
  title: nullableString,
  name: nullableString,
  overview: nullableString,
  poster_path: nullableString,
  release_date: nullableString,
  first_air_date: nullableString,
  genre_ids: z.array(z.number().int()).nullish(),
});

const searchSchema = z.object({
  page: z.number().int(),
  total_results: z.number().int(),
  results: z.array(z.unknown()),
});

const detailSchema = z.object({
  id: z.number().int(),
  title: nullableString,
  name: nullableString,
  overview: nullableString,
  poster_path: nullableString,
  release_date: nullableString,
  first_air_date: nullableString,
  genres: z.array(genreSchema).nullish(),
  runtime: z.number().int().nullish(),
  seasons: z
    .array(z.object({ season_number: z.number().int(), episode_count: z.number().int() }))
    .nullish(),
  credits: z
    .object({
      cast: z
        .array(
          z.object({
            name: z.string(),
            character: nullableString,
            profile_path: nullableString,
          }),
        )
        .nullish(),
    })
    .nullish(),
  videos: z
    .object({
      results: z
        .array(
          z.object({
            key: z.string(),
            name: z.string(),
            site: z.string(),
            type: z.string(),
            iso_639_1: nullableString,
          }),
        )
        .nullish(),
    })
    .nullish(),
});

function yearOf(date: string | null | undefined): number | null {
  const year = date ? Number.parseInt(date.slice(0, 4), 10) : Number.NaN;
  return Number.isInteger(year) && year > 0 ? year : null;
}

function pickTrailer(
  videos: { key: string; name: string; site: string; type: string; iso_639_1?: string | null }[],
): TmdbTrailer | null {
  const trailers = videos.filter((video) => video.site === 'YouTube' && video.type === 'Trailer');
  const chosen = trailers.find((video) => video.iso_639_1 === 'pt') ?? trailers[0];
  return chosen ? { site: 'YouTube', key: chosen.key, name: chosen.name } : null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function discard(response: Response | null): Promise<void> {
  await response?.body?.cancel().catch(() => undefined);
}

/**
 * Cliente HTTP do TMDB v3: pt-BR, timeout e uma retentativa curta (rede, 5xx e
 * 429; nunca 4xx). A chave nunca aparece em erros nem em logs.
 */
export function createHttpTmdbClient(options: HttpTmdbClientOptions): TmdbClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_TMDB_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 5000;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const doFetch = options.fetch ?? fetch;

  async function attempt(url: URL): Promise<Response | null> {
    try {
      return await doFetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return null;
    }
  }

  async function request(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(`${baseUrl}${path}`);
    url.searchParams.set('api_key', options.apiKey);
    url.searchParams.set('language', LANGUAGE);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    let response = await attempt(url);
    if (!response || response.status >= 500 || response.status === 429) {
      await discard(response);
      await sleep(retryDelayMs);
      response = await attempt(url);
    }
    if (!response) throw new AppError('TMDB_UNAVAILABLE');
    if (response.status === 404) {
      await discard(response);
      throw new AppError('TITLE_NOT_FOUND');
    }
    if (!response.ok) {
      await discard(response);
      throw new AppError('TMDB_UNAVAILABLE');
    }
    try {
      return await response.json();
    } catch {
      throw new AppError('TMDB_UNAVAILABLE');
    }
  }

  function parse<T>(schema: z.ZodType<T>, body: unknown): T {
    const result = schema.safeParse(body);
    if (!result.success) throw new AppError('TMDB_UNAVAILABLE', 'Resposta inesperada do TMDB.');
    return result.data;
  }

  return {
    async search(query, page): Promise<TmdbSearchPage> {
      const body = parse(
        searchSchema,
        await request('/search/multi', {
          query,
          page: String(page),
          include_adult: 'false',
        }),
      );
      const results: TmdbTitleSummary[] = [];
      for (const raw of body.results) {
        const item = searchResultSchema.safeParse(raw);
        if (!item.success) continue;
        const entry = item.data;
        if (entry.media_type !== 'movie' && entry.media_type !== 'tv') continue;
        const isMovie = entry.media_type === 'movie';
        results.push({
          tmdbId: entry.id,
          mediaType: isMovie ? 'MOVIE' : 'TV',
          name: (isMovie ? entry.title : entry.name) ?? '',
          overview: entry.overview ?? '',
          posterPath: entry.poster_path ?? null,
          releaseYear: yearOf(isMovie ? entry.release_date : entry.first_air_date),
          genreIds: entry.genre_ids ?? [],
        });
      }
      return { page: body.page, totalResults: body.total_results, results };
    },

    async getTitle(mediaType: TmdbMediaType, tmdbId): Promise<TmdbTitleDetail> {
      const isMovie = mediaType === 'MOVIE';
      const body = parse(
        detailSchema,
        await request(`/${isMovie ? 'movie' : 'tv'}/${tmdbId}`, {
          append_to_response: 'credits,videos',
          include_video_language: 'pt,en,null',
        }),
      );
      const genres = body.genres ?? [];
      return {
        tmdbId: body.id,
        mediaType,
        name: (isMovie ? body.title : body.name) ?? '',
        overview: body.overview ?? '',
        posterPath: body.poster_path ?? null,
        releaseYear: yearOf(isMovie ? body.release_date : body.first_air_date),
        genreIds: genres.map((genre) => genre.id),
        genres,
        runtime: isMovie ? (body.runtime ?? null) : null,
        seasons: isMovie
          ? null
          : (body.seasons ?? [])
              .filter((season) => season.season_number > 0)
              .map((season) => ({
                season: season.season_number,
                episodeCount: season.episode_count,
              })),
        cast: (body.credits?.cast ?? []).slice(0, CAST_LIMIT).map((member) => ({
          name: member.name,
          character: member.character || null,
          profilePath: member.profile_path ?? null,
        })),
        trailer: pickTrailer(body.videos?.results ?? []),
      };
    },
  };
}
