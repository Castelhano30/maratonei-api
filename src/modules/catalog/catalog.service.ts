import { config } from '../../config.js';
import { AppError } from '../../http/app-error.js';
import type { Page } from '../../http/pagination.js';
import { CATALOG_TTL_MS, GENRES_TTL_MS, createCache } from '../../lib/cache/index.js';
import {
  getTmdb,
  toPublicRating,
  type TmdbCatalogItem,
  type TmdbMediaType,
} from '../../lib/tmdb/index.js';
import type { CatalogCard, GenreList } from '../../openapi/common.js';
import { getCachedProviders, getCachedTmdbDetail } from '../titles/index.js';
import { CATALOG_MAX_PAGE, CATALOG_PAGE_SIZE, type CatalogQuery } from './catalog.schemas.js';

const NEWEST_MIN_VOTES = 10;
const WINDOW_RANKED_MIN_VOTES = 25;
const NOW_PLAYING_WINDOW_DAYS = 45;
const RECENT_WINDOW_DAYS = 180;
const ENRICHMENT_LIMIT = 10;
const STREAMING_PROVIDER_IDS = [8, 119, 337, 1899, 11];
const CATALOG_REGION = 'BR';
const CINEMA_RELEASE_TYPES = '2|3';
const DAY_MS = 24 * 60 * 60 * 1000;
const OVERVIEW_MAX_LENGTH = 220;

const catalogCache = createCache<Page<CatalogCard>>({ ttlMs: CATALOG_TTL_MS, staleIfError: true });
const genresCache = createCache<GenreList>({ ttlMs: GENRES_TTL_MS, staleIfError: true });

export function listGenres(mediaType: TmdbMediaType): Promise<GenreList> {
  return genresCache.get(mediaType, async () => ({ data: await getTmdb().listGenres(mediaType) }));
}

function discoverParams(mediaType: TmdbMediaType, query: CatalogQuery): Record<string, string> {
  const { collection, genreId, sort, page } = query;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const daysAgo = (days: number) =>
    new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
  const releaseDate = mediaType === 'MOVIE' ? 'primary_release_date' : 'first_air_date';
  const params: Record<string, string> = { region: CATALOG_REGION, page: String(page) };
  if (genreId !== undefined) params.with_genres = String(genreId);
  params.sort_by =
    sort === 'NEWEST'
      ? `${releaseDate}.desc`
      : sort === 'VOTE_AVERAGE'
        ? 'vote_average.desc'
        : 'popularity.desc';
  if (sort === 'NEWEST') {
    params['vote_count.gte'] = String(NEWEST_MIN_VOTES);
    params[`${releaseDate}.lte`] = today;
  } else if (sort === 'VOTE_AVERAGE') {
    params['vote_count.gte'] = String(
      collection === 'NOW_PLAYING' || collection === 'RECENT'
        ? WINDOW_RANKED_MIN_VOTES
        : mediaType === 'MOVIE'
          ? config.CATALOG_MIN_VOTES_MOVIE
          : config.CATALOG_MIN_VOTES_TV,
    );
  }
  if (collection === 'NOW_PLAYING') {
    params['release_date.gte'] = daysAgo(NOW_PLAYING_WINDOW_DAYS);
    params['release_date.lte'] = today;
    params.with_release_type = CINEMA_RELEASE_TYPES;
  } else if (collection === 'STREAMING') {
    params.with_watch_providers = STREAMING_PROVIDER_IDS.join('|');
    params.watch_region = CATALOG_REGION;
    params.with_watch_monetization_types = 'flatrate';
    params[`${releaseDate}.lte`] = today;
  } else if (collection === 'RECENT') {
    params['first_air_date.gte'] = daysAgo(RECENT_WINDOW_DAYS);
    params['first_air_date.lte'] = today;
  }
  return params;
}

function summarizeOverview(overview: string): string | null {
  const text = overview.trim();
  if (!text) return null;
  if (text.length <= OVERVIEW_MAX_LENGTH) return text;
  const prefix = text.slice(0, OVERVIEW_MAX_LENGTH - 1);
  const space = prefix.lastIndexOf(' ');
  return `${(space > 0 ? prefix.slice(0, space) : prefix).trimEnd()}…`;
}

function toCard(item: TmdbCatalogItem): CatalogCard {
  return {
    ...item,
    overview: summarizeOverview(item.overview),
    voteAverage: toPublicRating(item.voteAverage, item.voteCount),
    originCountry: item.mediaType === 'TV' ? item.originCountry : null,
    provider: null,
    latestSeason: null,
  };
}

async function enrich(card: CatalogCard, collection: CatalogQuery['collection']): Promise<void> {
  if (collection === 'STREAMING') {
    const providers = await getCachedProviders(card.mediaType, card.tmdbId);
    card.provider =
      providers.flatrate.find((provider) => STREAMING_PROVIDER_IDS.includes(provider.providerId)) ??
      null;
  } else if (collection === 'RECENT') {
    card.latestSeason = (await getCachedTmdbDetail(card.mediaType, card.tmdbId)).numberOfSeasons;
  } else if (collection === 'TOP_RATED' && card.mediaType === 'MOVIE') {
    card.originCountry =
      (await getCachedTmdbDetail(card.mediaType, card.tmdbId)).productionCountries[0] ?? null;
  }
}

export function listCatalog(
  mediaType: TmdbMediaType,
  input: CatalogQuery,
): Promise<Page<CatalogCard>> {
  if (
    (input.collection === 'NOW_PLAYING' && mediaType === 'TV') ||
    (input.collection === 'RECENT' && mediaType === 'MOVIE')
  ) {
    throw new AppError('VALIDATION_FAILED', {
      errors: [
        {
          field: 'collection',
          message: `A coleção ${input.collection} não está disponível para ${mediaType}.`,
        },
      ],
    });
  }
  const query: CatalogQuery = {
    ...input,
    sort: input.collection === 'TOP_RATED' ? 'VOTE_AVERAGE' : input.sort,
  };
  const { collection, genreId, sort, page } = query;
  const key = JSON.stringify([mediaType, collection, genreId ?? null, sort, page]);
  return catalogCache.get(key, async () => {
    const result =
      collection === 'NOW_PLAYING' && genreId === undefined && sort === 'POPULARITY'
        ? await getTmdb().getNowPlaying(page)
        : await getTmdb().discover(mediaType, discoverParams(mediaType, query));
    const data = result.results.map(toCard);
    // O enriquecimento é opcional: cada falha preserva o campo nulo do cartão.
    if (page === 1)
      await Promise.allSettled(
        data.slice(0, ENRICHMENT_LIMIT).map((card) => enrich(card, collection)),
      );
    return {
      data,
      page,
      pageSize: CATALOG_PAGE_SIZE,
      total: Math.min(result.totalResults, CATALOG_MAX_PAGE * CATALOG_PAGE_SIZE),
    };
  });
}
