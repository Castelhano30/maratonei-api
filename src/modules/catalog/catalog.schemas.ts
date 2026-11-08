import { CatalogCard, MediaType, pageOf } from '../../openapi/common.js';
import { z } from '../../openapi/registry.js';

export const CATALOG_PAGE_SIZE = 20;
export const CATALOG_MAX_PAGE = 500;

export const CatalogParams = z.object({ mediaType: MediaType });
export const GenresQuery = z.object({ mediaType: MediaType });
export const CatalogQuery = z.object({
  collection: z.enum(['ALL', 'NOW_PLAYING', 'STREAMING', 'TOP_RATED', 'RECENT']).default('ALL'),
  genreId: z.coerce.number().int().positive().optional(),
  sort: z.enum(['POPULARITY', 'NEWEST', 'VOTE_AVERAGE']).default('POPULARITY').openapi({
    description: 'Em TOP_RATED, a ordem é sempre VOTE_AVERAGE e este parâmetro é ignorado.',
  }),
  page: z.coerce.number().int().min(1).max(CATALOG_MAX_PAGE).default(1),
});
export type CatalogQuery = z.infer<typeof CatalogQuery>;

export const CatalogPage = pageOf(CatalogCard)
  .extend({ pageSize: z.literal(CATALOG_PAGE_SIZE) })
  .openapi('CatalogPage');
