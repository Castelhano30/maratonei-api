import { PageQuery } from '../../http/pagination.js';
import { ListRole, UserSummary, pageOf } from '../../openapi/common.js';
import { z } from '../../openapi/registry.js';

export const ListIdParams = z.object({ listId: z.uuid() });

/** Nome 1–80 e descrição até 500 caracteres, após trim. */
const listName = z.string().trim().min(1).max(80).openapi({ example: 'Maratona de sábado' });
const listDescription = z.string().trim().max(500);

export const CreateListBody = z
  .object({
    name: listName,
    description: listDescription.nullish().openapi({ example: 'Filmes para ver juntos' }),
  })
  .openapi('CreateListBody');

export const UpdateListBody = z
  .object({
    name: listName.optional(),
    description: listDescription.nullish(),
  })
  .refine((body) => body.name !== undefined || body.description !== undefined, {
    message: 'Informe ao menos um campo (name ou description).',
  })
  .openapi('UpdateListBody');

export const ListsQuery = PageQuery.extend({
  sort: z.enum(['updatedAt:desc', 'updatedAt:asc']).default('updatedAt:desc'),
});

export const ListSummary = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    role: ListRole,
    memberCount: z.number().int().min(1),
    itemCount: z.number().int().min(0).openapi({ description: 'Total de títulos na lista.' }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi('ListSummary');

export const ListSummaryPage = pageOf(ListSummary).openapi('ListSummaryPage');

export const ListDetail = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    ownerId: z.uuid(),
    role: ListRole.openapi({ description: 'Papel do usuário da sessão nesta lista.' }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi('ListDetail');

export const Member = z
  .object({
    id: z.uuid().openapi({ description: 'Id do vínculo (`ListMember`), não do usuário.' }),
    user: UserSummary,
    role: ListRole,
    joinedAt: z.iso.datetime(),
  })
  .openapi('Member');

export const MemberPage = pageOf(Member).openapi('MemberPage');

export const MemberParams = z.object({ listId: z.uuid(), memberId: z.uuid() });

export const SetRoleBody = z.object({ role: z.enum(['EDITOR', 'MEMBER']) }).openapi('SetRoleBody');

export type CreateListBody = z.infer<typeof CreateListBody>;
export type UpdateListBody = z.infer<typeof UpdateListBody>;
export type ListSummary = z.infer<typeof ListSummary>;
export type ListDetail = z.infer<typeof ListDetail>;
export type Member = z.infer<typeof Member>;
