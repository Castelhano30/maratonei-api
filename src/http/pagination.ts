import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** `?page=1&pageSize=20` (máximo 100). Base de toda query de coleção. */
export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PageParams = z.output<typeof PageQuery>;

export interface Page<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** `skip`/`take` do Prisma para a página pedida. */
export function pageArgs({ page, pageSize }: PageParams): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function toPage<T>(data: T[], total: number, { page, pageSize }: PageParams): Page<T> {
  return { data, page, pageSize, total };
}
