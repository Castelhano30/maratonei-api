import type { ItemStatus, List, ListItem, Title } from '../../src/generated/prisma/client.js';
import { prisma } from '../../src/lib/prisma.js';
import { createTitle, type CreateTitleInput } from './title.js';

export interface CreateListItemInput {
  title?: Pick<Title, 'id'>;
  /** Cria um título novo com estes campos quando `title` é omitido. */
  titleInput?: CreateTitleInput;
  addedById?: string | null;
  status?: ItemStatus;
  addedAt?: Date;
}

/** Cria um item na lista (com título novo, se omitido). */
export async function createListItem(
  list: Pick<List, 'id'>,
  input: CreateListItemInput = {},
): Promise<ListItem & { title: Title }> {
  const title = input.title ?? (await createTitle(input.titleInput));
  return prisma.listItem.create({
    data: {
      listId: list.id,
      titleId: title.id,
      addedById: input.addedById ?? null,
      status: input.status ?? 'WANT',
      ...(input.addedAt ? { addedAt: input.addedAt } : {}),
    },
    include: { title: true },
  });
}
