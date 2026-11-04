import type { Comment, ListItem, ListMember, Rating } from '../../src/generated/prisma/client.js';
import { prisma } from '../../src/lib/prisma.js';

/** Cria (ou substitui) a nota de um membro num item. */
export async function createRating(
  item: Pick<ListItem, 'id'>,
  member: Pick<ListMember, 'id'>,
  stars = 4,
): Promise<Rating> {
  return prisma.rating.upsert({
    where: { listItemId_memberId: { listItemId: item.id, memberId: member.id } },
    create: { listItemId: item.id, memberId: member.id, stars },
    update: { stars },
  });
}

export interface CreateCommentInput {
  body?: string;
  createdAt?: Date;
}

/** Cria um comentário de um membro num item. */
export async function createComment(
  item: Pick<ListItem, 'id'>,
  member: Pick<ListMember, 'id'>,
  input: CreateCommentInput = {},
): Promise<Comment> {
  return prisma.comment.create({
    data: {
      listItemId: item.id,
      memberId: member.id,
      body: input.body ?? 'Comentário de teste',
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });
}
