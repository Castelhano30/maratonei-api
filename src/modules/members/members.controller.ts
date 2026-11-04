import type { RequestHandler } from 'express';
import { membershipOf } from '../../http/access.js';
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
  const membership = membershipOf(req);
  const { query } = validate(req, { query: PageQuery });
  res.json(await listMembers(membership.listId, query));
};

export const leave: RequestHandler = async (req, res) => {
  const membership = membershipOf(req);
  await leaveList(membership.listId, membership.id);
  res.status(204).end();
};

export const remove: RequestHandler = async (req, res) => {
  const membership = membershipOf(req);
  const { params } = validate(req, { params: MemberParams });
  await removeMember(membership.listId, params.memberId);
  res.status(204).end();
};

export const setRole: RequestHandler = async (req, res) => {
  const membership = membershipOf(req);
  const { params, body } = validate(req, { params: MemberParams, body: SetRoleBody });
  res.json(await setMemberRole(membership.listId, params.memberId, body.role));
};
