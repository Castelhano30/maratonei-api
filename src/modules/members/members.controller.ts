import type { RequestHandler } from 'express';
import { AppError } from '../../http/app-error.js';
import { PageQuery } from '../../http/pagination.js';
import { validate } from '../../http/validate.js';
import {
  leaveList,
  listMembers,
  MemberParams,
  removeMember,
  SetRoleBody,
  setMemberRole,
} from '../lists/index.js';

export const getMembers: RequestHandler = async (req, res) => {
  const membership = req.membership;
  if (!membership) throw new AppError('LIST_NOT_FOUND');
  const { query } = validate(req, { query: PageQuery });
  res.json(await listMembers(membership.listId, query));
};

export const leave: RequestHandler = async (req, res) => {
  const membership = req.membership;
  if (!membership) throw new AppError('LIST_NOT_FOUND');
  await leaveList(membership.listId, membership.id);
  res.status(204).end();
};

export const remove: RequestHandler = async (req, res) => {
  const membership = req.membership;
  if (!membership) throw new AppError('LIST_NOT_FOUND');
  const { params } = validate(req, { params: MemberParams });
  await removeMember(membership.listId, params.memberId);
  res.status(204).end();
};

export const setRole: RequestHandler = async (req, res) => {
  const membership = req.membership;
  if (!membership) throw new AppError('LIST_NOT_FOUND');
  const { params, body } = validate(req, { params: MemberParams, body: SetRoleBody });
  res.json(await setMemberRole(membership.listId, params.memberId, body.role));
};
