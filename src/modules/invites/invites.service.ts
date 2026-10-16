import { randomBytes } from 'node:crypto';
import { AppError } from '../../http/app-error.js';
import { prisma } from '../../lib/prisma.js';
import { addMember, lockList } from '../lists/index.js';
import type { Invite, InvitePreview } from './invites.schemas.js';

/** 32 bytes aleatórios em base64url (regra 3 da matriz). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

function toInvite(row: { token: string; createdAt: Date }): Invite {
  return { token: row.token, createdAt: row.createdAt.toISOString() };
}

export async function getActiveInvite(listId: string): Promise<Invite> {
  const invite = await prisma.invite.findFirst({
    where: { listId, revokedAt: null },
    select: { token: true, createdAt: true },
  });
  if (!invite) throw new AppError('INVITE_NOT_FOUND');
  return toInvite(invite);
}

/** Gera ou rotaciona: revoga o ativo e cria outro, na mesma transação e com a lista travada. */
export async function rotateInvite(listId: string, userId: string): Promise<Invite> {
  return prisma.$transaction(async (tx) => {
    await lockList(tx, listId);
    await tx.invite.updateMany({
      where: { listId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const created = await tx.invite.create({
      data: { listId, token: generateToken(), createdById: userId },
      select: { token: true, createdAt: true },
    });
    return toInvite(created);
  });
}

export async function revokeInvite(listId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockList(tx, listId);
    const { count } = await tx.invite.updateMany({
      where: { listId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new AppError('INVITE_NOT_FOUND');
  });
}

async function findActiveByToken(token: string) {
  const invite = await prisma.invite.findFirst({
    where: { token, revokedAt: null },
    select: { listId: true, list: { select: { name: true } } },
  });
  if (!invite) throw new AppError('INVITE_NOT_FOUND');
  return invite;
}

export async function previewInvite(token: string, userId: string): Promise<InvitePreview> {
  const invite = await findActiveByToken(token);
  const membership = await prisma.listMember.findUnique({
    where: { listId_userId: { listId: invite.listId, userId } },
    select: { id: true },
  });
  return { listId: invite.listId, listName: invite.list.name, alreadyMember: membership !== null };
}

/** Aceite idempotente: quem já é membro recebe `alreadyMember: true` sem mudança. */
export async function acceptInvite(token: string, userId: string): Promise<InvitePreview> {
  const invite = await findActiveByToken(token);
  const result = await addMember(invite.listId, userId, { inviteToken: token });
  return { listId: invite.listId, listName: invite.list.name, alreadyMember: !result.created };
}
