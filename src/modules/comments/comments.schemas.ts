import { PageQuery } from '../../http/pagination.js';
import { UserSummary, pageOf } from '../../openapi/common.js';
import { z } from '../../openapi/registry.js';

export const MAX_COMMENT_LENGTH = 2000;

export const CommentsParams = z.object({ listId: z.uuid(), itemId: z.uuid() });
export const CommentParams = CommentsParams.extend({ commentId: z.uuid() });

export const CommentsQuery = PageQuery.extend({
  sort: z.enum(['createdAt:desc', 'createdAt:asc']).default('createdAt:desc'),
});

export const CommentBody = z
  .object({
    body: z
      .string()
      .trim()
      .min(1)
      .max(MAX_COMMENT_LENGTH)
      .openapi({
        description: `Texto sem espaços nas pontas, de 1 a ${MAX_COMMENT_LENGTH} caracteres.`,
      }),
  })
  .openapi('CommentBody');

export const Comment = z
  .object({
    id: z.uuid(),
    author: UserSummary,
    body: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi('Comment');

export const CommentPage = pageOf(Comment).openapi('CommentPage');

export type CommentsQuery = z.output<typeof CommentsQuery>;
export type CommentBody = z.infer<typeof CommentBody>;
export type Comment = z.infer<typeof Comment>;
