import { config } from '../../config.js';
import { AppError } from '../../http/app-error.js';
import { pageArgs, toPage, type Page, type PageParams } from '../../http/pagination.js';
import type { ListRole } from '../../generated/prisma/client.js';
import { prisma, type Prisma } from '../../lib/prisma.js';
import { countItemsByStatus } from '../items/index.js';
import type {
  CreateListBody,
  ListDetail,
  ListSummary,
  Member,
  UpdateListBody,
} from './lists.schemas.js';

type Tx = Prisma.TransactionClient;

function toDetail(
  list: {
    id: string;
    name: string;
    description: string | null;
    ownerId: string;
    createdAt: Date;
    updatedAt: Date;
  },
  role: ListRole,
  statusCounts: ListDetail['statusCounts'],
): ListDetail {
  return {
    id: list.id,
    name: list.name,
    description: list.description,
    ownerId: list.ownerId,
    role,
    statusCounts,
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
  };
}

/** Descrição vazia após o trim vira `null`. */
function normalizeDescription(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value === null || value === '' ? null : value;
}

const memberSelect = {
  id: true,
  role: true,
  joinedAt: true,
  user: { select: { id: true, name: true, image: true } },
} as const;

export async function createList(userId: string, body: CreateListBody): Promise<ListDetail> {
  const list = await prisma.list.create({
    data: {
      name: body.name,
      description: normalizeDescription(body.description) ?? null,
      ownerId: userId,
      members: { create: { userId, role: 'OWNER' } },
    },
  });
  return toDetail(list, 'OWNER', { WANT: 0, WATCHING: 0, WATCHED: 0 });
}

export async function listListsOf(
  userId: string,
  params: PageParams & { sort: 'updatedAt:desc' | 'updatedAt:asc' },
): Promise<Page<ListSummary>> {
  const where: Prisma.ListWhereInput = { members: { some: { userId } } };
  const direction = params.sort === 'updatedAt:asc' ? 'asc' : 'desc';
  const [rows, total] = await Promise.all([
    prisma.list.findMany({
      where,
      orderBy: [{ updatedAt: direction }, { id: direction }],
      ...pageArgs(params),
      include: {
        _count: { select: { members: true, items: true } },
        members: { where: { userId }, select: { role: true } },
      },
    }),
    prisma.list.count({ where }),
  ]);
  const data = rows.map((list) => ({
    id: list.id,
    name: list.name,
    description: list.description,
    role: list.members[0]?.role ?? 'MEMBER',
    memberCount: list._count.members,
    itemCount: list._count.items,
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
  }));
  return toPage(data, total, params);
}

export async function getList(listId: string, role: ListRole): Promise<ListDetail> {
  const list = await prisma.list.findUnique({ where: { id: listId } });
  if (!list) throw new AppError('LIST_NOT_FOUND');
  return toDetail(list, role, await countItemsByStatus(listId));
}

export async function updateList(
  listId: string,
  role: ListRole,
  body: UpdateListBody,
): Promise<ListDetail> {
  const data: Prisma.ListUpdateInput = {};
  if (body.name !== undefined) data.name = body.name;
  const description = normalizeDescription(body.description);
  if (description !== undefined) data.description = description;
  const list = await prisma.list.update({ where: { id: listId }, data });
  return toDetail(list, role, await countItemsByStatus(listId));
}

/** Exclui a lista; membros e convite vão em cascata pelo banco. */
export async function deleteList(listId: string): Promise<void> {
  await prisma.list.delete({ where: { id: listId } });
}

function toMember(row: {
  id: string;
  role: ListRole;
  joinedAt: Date;
  user: { id: string; name: string; image: string | null };
}): Member {
  return { id: row.id, user: row.user, role: row.role, joinedAt: row.joinedAt.toISOString() };
}

export async function listMembers(listId: string, params: PageParams): Promise<Page<Member>> {
  const [rows, total] = await Promise.all([
    prisma.listMember.findMany({
      where: { listId },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      ...pageArgs(params),
      select: memberSelect,
    }),
    prisma.listMember.count({ where: { listId } }),
  ]);
  return toPage(rows.map(toMember), total, params);
}

export interface AddMemberResult {
  role: ListRole;
  /** `false` quando o usuário já era membro (nada mudou). */
  created: boolean;
}

/**
 * Único ponto que cria `ListMember` de papel `MEMBER` (RF-08/09). Trava a linha
 * da lista (`FOR UPDATE`) para que o teto `MAX_LIST_MEMBERS` valha sob
 * concorrência. Já ser membro é sucesso idempotente, mesmo com a lista cheia.
 */
export async function addMember(
  listId: string,
  userId: string,
  options: { inviteToken?: string } = {},
): Promise<AddMemberResult> {
  return prisma.$transaction(async (tx) => {
    await lockList(tx, listId);
    // Com a lista travada, o convite precisa continuar ativo (o dono pode ter revogado ou rotacionado).
    if (options.inviteToken !== undefined) {
      const invite = await tx.invite.findFirst({
        where: { listId, token: options.inviteToken, revokedAt: null },
        select: { id: true },
      });
      if (!invite) throw new AppError('INVITE_NOT_FOUND');
    }
    const existing = await tx.listMember.findUnique({
      where: { listId_userId: { listId, userId } },
      select: { role: true },
    });
    if (existing) return { role: existing.role, created: false };

    const count = await tx.listMember.count({ where: { listId } });
    if (count >= config.MAX_LIST_MEMBERS) {
      throw new AppError('LIST_MEMBER_LIMIT', 'A lista atingiu o número máximo de membros.');
    }
    await tx.listMember.create({ data: { listId, userId, role: 'MEMBER' } });
    return { role: 'MEMBER', created: true };
  });
}

/** Trava a linha da lista (FOR UPDATE); serializa operações concorrentes sobre ela. */
export async function lockList(tx: Tx, listId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "list" WHERE id = ${listId}::uuid FOR UPDATE
  `;
  if (rows.length === 0) throw new AppError('LIST_NOT_FOUND');
}

/** Sair da lista: apaga o vínculo (cascata nos dados do membro). O dono não sai. */
export async function leaveList(listId: string, membershipId: string): Promise<void> {
  const membership = await prisma.listMember.findFirst({
    where: { id: membershipId, listId },
    select: { role: true },
  });
  if (!membership) throw new AppError('LIST_NOT_FOUND');
  if (membership.role === 'OWNER') {
    throw new AppError('OWNER_IMMUTABLE', 'O dono não pode sair; exclua a lista.');
  }
  await prisma.listMember.deleteMany({ where: { id: membershipId, listId } });
}

async function findTarget(listId: string, memberId: string) {
  const target = await prisma.listMember.findFirst({
    where: { id: memberId, listId },
    select: { id: true, role: true },
  });
  if (!target) throw new AppError('MEMBER_NOT_FOUND');
  if (target.role === 'OWNER') {
    throw new AppError('OWNER_IMMUTABLE', 'O dono não pode ser removido nem rebaixado.');
  }
  return target;
}

export async function removeMember(listId: string, memberId: string): Promise<void> {
  const target = await findTarget(listId, memberId);
  await prisma.listMember.deleteMany({ where: { id: target.id, listId } });
}

export async function setMemberRole(
  listId: string,
  memberId: string,
  role: 'EDITOR' | 'MEMBER',
): Promise<Member> {
  const target = await findTarget(listId, memberId);
  const updated = await prisma.listMember.update({
    where: { id: target.id },
    data: { role },
    select: memberSelect,
  });
  return toMember(updated);
}
