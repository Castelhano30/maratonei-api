import { AppError } from '../../http/app-error.js';
import { pageArgs, toPage, type Page } from '../../http/pagination.js';
import { prisma, type Prisma } from '../../lib/prisma.js';
import type { Comment, CommentsQuery } from './comments.schemas.js';

const commentInclude = {
  member: { select: { user: { select: { id: true, name: true, image: true } } } },
} satisfies Prisma.CommentInclude;

type CommentRow = Prisma.CommentGetPayload<{ include: typeof commentInclude }>;

function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    author: row.member.user,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listComments(itemId: string, query: CommentsQuery): Promise<Page<Comment>> {
  const direction = query.sort === 'createdAt:asc' ? 'asc' : 'desc';
  const [rows, total] = await Promise.all([
    prisma.comment.findMany({
      where: { listItemId: itemId },
      orderBy: [{ createdAt: direction }, { id: direction }],
      ...pageArgs(query),
      include: commentInclude,
    }),
    prisma.comment.count({ where: { listItemId: itemId } }),
  ]);
  return toPage(rows.map(toComment), total, query);
}

export async function createComment(
  itemId: string,
  memberId: string,
  body: string,
): Promise<Comment> {
  const row = await prisma.comment.create({
    data: { listItemId: itemId, memberId, body },
    include: commentInclude,
  });
  return toComment(row);
}

/**
 * Carrega o comentário do item e confere a autoria: inexistente (ou de outro
 * item) → 404 `COMMENT_NOT_FOUND`; de outro membro → 403 `NOT_OWN_RESOURCE`.
 */
async function ownComment(itemId: string, commentId: string, memberId: string): Promise<void> {
  const row = await prisma.comment.findFirst({
    where: { id: commentId, listItemId: itemId },
    select: { memberId: true },
  });
  if (!row) throw new AppError('COMMENT_NOT_FOUND');
  if (row.memberId !== memberId) throw new AppError('NOT_OWN_RESOURCE');
}

export async function updateComment(
  itemId: string,
  commentId: string,
  memberId: string,
  body: string,
): Promise<Comment> {
  await ownComment(itemId, commentId, memberId);
  // `memberId` no where: se o comentário mudou de mãos entre a checagem e a escrita, não altera.
  const { count } = await prisma.comment.updateMany({
    where: { id: commentId, listItemId: itemId, memberId },
    data: { body, updatedAt: new Date() },
  });
  if (count === 0) throw new AppError('COMMENT_NOT_FOUND');
  const row = await prisma.comment.findUniqueOrThrow({
    where: { id: commentId },
    include: commentInclude,
  });
  return toComment(row);
}

export async function deleteComment(
  itemId: string,
  commentId: string,
  memberId: string,
): Promise<void> {
  await ownComment(itemId, commentId, memberId);
  await prisma.comment.deleteMany({ where: { id: commentId, listItemId: itemId, memberId } });
}
