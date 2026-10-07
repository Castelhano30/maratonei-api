import type { ResponseConfig } from '@asteasolutions/zod-to-openapi';
import { ERROR_CODES } from '../http/error-codes.js';
import { PROBLEM_CONTENT_TYPE } from '../http/problem.js';
import { MAX_PAGE_SIZE } from '../http/pagination.js';
import { registry, z } from './registry.js';

/**
 * Formatos compartilhados (AD-12). Toda rota reutiliza estes componentes em vez
 * de declarar o seu próprio formato de usuário, página, erro ou enum.
 */

// Enums: valores UPPER idênticos no banco, no JSON, na query e no path.
export const MediaType = registry.register('MediaType', z.enum(['MOVIE', 'TV']));
export const ItemStatus = registry.register('ItemStatus', z.enum(['WANT', 'WATCHING', 'WATCHED']));
export const ListRole = registry.register('ListRole', z.enum(['OWNER', 'EDITOR', 'MEMBER']));

export const UserSummary = registry.register(
  'UserSummary',
  z.object({
    id: z.uuid(),
    name: z.string(),
    image: z.string().nullable(),
  }),
);

export const ErrorCodeSchema = registry.register('ErrorCode', z.enum(ERROR_CODES));

export const FieldErrorSchema = registry.register(
  'FieldError',
  z.object({
    field: z.string().openapi({ example: 'pageSize' }),
    message: z.string(),
  }),
);

export const Problem = registry.register(
  'Problem',
  z
    .object({
      type: z.literal('about:blank'),
      title: z.string().openapi({ example: 'Bad Request' }),
      status: z.number().int().openapi({ example: 400 }),
      code: ErrorCodeSchema,
      detail: z.string().optional(),
      errors: z.array(FieldErrorSchema).optional(),
    })
    .openapi({
      description:
        'Erro RFC 9457 (application/problem+json). Trate `code` como um conjunto aberto.',
    }),
);

/** `Page<T>`: toda coleção responde neste formato (`pageSize` ≤ 100). */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE),
    total: z.number().int().min(0),
  });
}

/** Resposta de erro padrão para `responses` do registry. */
export function problemResponse(description: string): ResponseConfig {
  return {
    description,
    content: { [PROBLEM_CONTENT_TYPE]: { schema: Problem } },
  };
}
