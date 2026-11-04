import { randomBytes, randomUUID } from 'node:crypto';
import type {
  Invite,
  List,
  ListMember,
  ListRole,
  User,
} from '../../src/generated/prisma/client.js';
import { prisma } from '../../src/lib/prisma.js';
import { createUser } from './user.js';

export interface CreateListInput {
  owner?: Pick<User, 'id'>;
  name?: string;
  description?: string | null;
}

/** Cria uma lista com o dono já vinculado como `OWNER`. */
export async function createList(
  input: CreateListInput = {},
): Promise<List & { ownerMember: ListMember }> {
  const owner = input.owner ?? (await createUser());
  const list = await prisma.list.create({
    data: {
      name: input.name ?? `Lista ${randomUUID().slice(0, 8)}`,
      description: input.description ?? null,
      ownerId: owner.id,
      members: { create: { userId: owner.id, role: 'OWNER' } },
    },
    include: { members: true },
  });
  const { members, ...rest } = list;
  const ownerMember = members[0];
  if (!ownerMember) throw new Error('A lista foi criada sem o vínculo do dono.');
  return { ...rest, ownerMember };
}

/** Vincula um usuário (novo, se omitido) à lista com o papel dado. */
export async function createMembership(
  list: Pick<List, 'id'>,
  options: { user?: Pick<User, 'id'>; role?: ListRole } = {},
): Promise<ListMember> {
  const user = options.user ?? (await createUser());
  return prisma.listMember.create({
    data: { listId: list.id, userId: user.id, role: options.role ?? 'MEMBER' },
  });
}

/** Cria um convite (ativo por padrão; `revoked: true` cria um já revogado). */
export async function createInvite(
  list: Pick<List, 'id'>,
  options: { token?: string; revoked?: boolean; createdById?: string } = {},
): Promise<Invite> {
  return prisma.invite.create({
    data: {
      listId: list.id,
      token: options.token ?? randomBytes(32).toString('base64url'),
      createdById: options.createdById ?? null,
      revokedAt: options.revoked ? new Date() : null,
    },
  });
}
