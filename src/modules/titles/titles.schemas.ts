import { MediaType, TitleSummary, pageOf } from '../../openapi/common.js';
import { z } from '../../openapi/registry.js';

/** O TMDB só pagina até 500. */
export const SEARCH_MAX_PAGE = 500;
export const SEARCH_PAGE_SIZE = 20;

export const SearchQuery = z.object({
  q: z.string().trim().min(1).max(100).openapi({ example: 'duna' }),
  page: z.coerce.number().int().min(1).max(SEARCH_MAX_PAGE).default(1),
});

export const TitleParams = z.object({
  mediaType: MediaType,
  tmdbId: z.coerce.number().int().min(1).max(2_147_483_647),
});

export const TitleSearchPage = pageOf(TitleSummary)
  .extend({ pageSize: z.literal(SEARCH_PAGE_SIZE) })
  .openapi('TitleSearchPage', {
    description:
      '`pageSize` fixo em 20. `total` vem do TMDB e é aproximado (pessoas são descartadas).',
  });

export const Genre = z.object({ id: z.number().int(), name: z.string() }).openapi('Genre');

export const CastMember = z
  .object({
    name: z.string(),
    character: z.string().nullable(),
    profilePath: z.string().nullable(),
  })
  .openapi('CastMember');

export const Trailer = z
  .object({ site: z.literal('YouTube'), key: z.string(), name: z.string() })
  .openapi('Trailer');

export const SeasonSummary = z
  .object({ season: z.number().int().min(1), episodeCount: z.number().int().min(0) })
  .openapi('SeasonSummary');

export const TitleDetail = TitleSummary.extend({
  genres: z.array(Genre),
  runtime: z.number().int().nullable().openapi({ description: 'Minutos (filmes).' }),
  seasons: z.array(SeasonSummary).nullable().openapi({ description: 'Séries; `null` em filmes.' }),
  cast: z.array(CastMember).openapi({ description: 'Elenco principal (até 10).' }),
  trailer: Trailer.nullable(),
}).openapi('TitleDetail');

export type TitleDetail = z.infer<typeof TitleDetail>;
