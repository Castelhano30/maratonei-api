import type { RequestHandler } from 'express';
import { z } from 'zod';
import type { ListRole } from '../generated/prisma/client.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from './app-error.js';

export interface Membership {
  /** `ListMember.id`: é ele (e não o `userId`) que identifica autoria nas fases seguintes. */
  id: string;
  listId: string;
  userId: string;
  role: ListRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Preenchido por `requireListRole`. */
      membership?: Membership;
    }
  }
}

/** Hierarquia `OWNER ⊃ EDITOR ⊃ MEMBER` (AD-7). */
const ROLE_RANK: Record<ListRole, number> = { MEMBER: 1, EDITOR: 2, OWNER: 3 };

export function hasRole(role: ListRole, minimum: ListRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

const listIdSchema = z.uuid();

/**
 * Única porta de autorização de lista (AD-7). Lê só `ListMember.role` da rota
 * `:listId`: não membro, lista inexistente ou id malformado → 404 `LIST_NOT_FOUND`
 * (não revela que a lista existe); papel abaixo do mínimo → 403 `INSUFFICIENT_ROLE`.
 * Deve vir depois de `requireSession`.
 */
export function requireListRole(minimum: ListRole): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.user) throw new AppError('UNAUTHENTICATED');
      const parsed = listIdSchema.safeParse(req.params.listId);
      if (!parsed.success) throw new AppError('LIST_NOT_FOUND');

      const membership = await prisma.listMember.findUnique({
        where: { listId_userId: { listId: parsed.data, userId: req.user.id } },
        select: { id: true, listId: true, userId: true, role: true },
      });
      if (!membership) throw new AppError('LIST_NOT_FOUND');
      if (!hasRole(membership.role, minimum)) throw new AppError('INSUFFICIENT_ROLE');

      req.membership = membership;
      next();
    } catch (error) {
      next(error);
    }
  };
}

const itemIdSchema = z.uuid();

/**
 * Garante que `:itemId` é um item da lista da rota (`req.membership.listId`);
 * item inexistente, malformado ou de outra lista → 404 `ITEM_NOT_FOUND`.
 * Deve vir depois de `requireListRole`.
 */
export function requireItem(): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.membership) throw new AppError('LIST_NOT_FOUND');
      const parsed = itemIdSchema.safeParse(req.params.itemId);
      if (!parsed.success) throw new AppError('ITEM_NOT_FOUND');
      const item = await prisma.listItem.findFirst({
        where: { id: parsed.data, listId: req.membership.listId },
        select: { id: true },
      });
      if (!item) throw new AppError('ITEM_NOT_FOUND');
      next();
    } catch (error) {
      next(error);
    }
  };
}
