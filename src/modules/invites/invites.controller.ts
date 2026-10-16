import type { Request, RequestHandler } from 'express';
import { AppError } from '../../http/app-error.js';
import { validate } from '../../http/validate.js';
import { InviteTokenParams } from './invites.schemas.js';
import * as service from './invites.service.js';

function listIdOf(req: Request): string {
  if (!req.membership) throw new AppError('LIST_NOT_FOUND');
  return req.membership.listId;
}

export const getInvite: RequestHandler = async (req, res) => {
  res.json(await service.getActiveInvite(listIdOf(req)));
};

export const rotateInvite: RequestHandler = async (req, res) => {
  if (!req.user) throw new AppError('UNAUTHENTICATED');
  res.status(201).json(await service.rotateInvite(listIdOf(req), req.user.id));
};

export const revokeInvite: RequestHandler = async (req, res) => {
  await service.revokeInvite(listIdOf(req));
  res.status(204).end();
};

export const previewInvite: RequestHandler = async (req, res) => {
  if (!req.user) throw new AppError('UNAUTHENTICATED');
  const { params } = validate(req, { params: InviteTokenParams });
  res.json(await service.previewInvite(params.token, req.user.id));
};

export const acceptInvite: RequestHandler = async (req, res) => {
  if (!req.user) throw new AppError('UNAUTHENTICATED');
  const { params } = validate(req, { params: InviteTokenParams });
  res.json(await service.acceptInvite(params.token, req.user.id));
};
