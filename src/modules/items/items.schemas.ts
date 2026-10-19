import { PageQuery } from '../../http/pagination.js';
import { ItemStatus, MediaType, TitleSummary, UserSummary, pageOf } from '../../openapi/common.js';
import { z } from '../../openapi/registry.js';

export const ListParams = z.object({ listId: z.uuid() });
export const ItemParams = z.object({ listId: z.uuid(), itemId: z.uuid() });

export const ItemsQuery = PageQuery.extend({
  status: ItemStatus.optional(),
  mediaType: MediaType.optional(),
  genreId: z.coerce
    .number()
    .int()
    .min(1)
    .max(2_147_483_647)
    .optional()
    .openapi({ description: 'Id de gênero do TMDB (`TitleSummary.genreIds`).' }),
  sort: z.enum(['addedAt:desc', 'addedAt:asc']).default('addedAt:desc'),
});

export const AddItemBody = z
  .object({ mediaType: MediaType, tmdbId: z.number().int().min(1).max(2_147_483_647) })
  .openapi('AddItemBody');

export const SetItemStatusBody = z.object({ status: ItemStatus }).openapi('SetItemStatusBody');

export const ListItem = z
  .object({
    id: z.uuid(),
    title: TitleSummary,
    status: ItemStatus,
    addedBy: UserSummary.nullable().openapi({
      description: '`null` quando quem adicionou excluiu a conta.',
    }),
    addedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    ratingAverage: z.number().min(1).max(5).nullable().openapi({
      description: 'Média das notas; `null` sem notas (as notas chegam na Fase 5).',
    }),
    ratingCount: z.number().int().min(0),
  })
  .openapi('ListItem');

export const ListItemPage = pageOf(ListItem).openapi('ListItemPage');

export type ItemsQuery = z.output<typeof ItemsQuery>;
export type AddItemBody = z.infer<typeof AddItemBody>;
export type ListItem = z.infer<typeof ListItem>;
