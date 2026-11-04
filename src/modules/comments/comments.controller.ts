import type { RequestHandler } from 'express';
import { membershipOf } from '../../http/access.js';
import { validate } from '../../http/validate.js';
import { CommentBody, CommentParams, CommentsQuery } from './comments.schemas.js';
import * as service from './comments.service.js';
import { ListItemParams } from '../../openapi/common.js';

export const list: RequestHandler = async (req, res) => {
  membershipOf(req);
  const { params, query } = validate(req, { params: ListItemParams, query: CommentsQuery });
  res.json(await service.listComments(params.itemId, query));
};

export const create: RequestHandler = async (req, res) => {
  const { id } = membershipOf(req);
  const { params, body } = validate(req, { params: ListItemParams, body: CommentBody });
  res.status(201).json(await service.createComment(params.itemId, id, body.body));
};

export const update: RequestHandler = async (req, res) => {
  const { id } = membershipOf(req);
  const { params, body } = validate(req, { params: CommentParams, body: CommentBody });
  res.json(await service.updateComment(params.itemId, params.commentId, id, body.body));
};

export const remove: RequestHandler = async (req, res) => {
  const { id } = membershipOf(req);
  const { params } = validate(req, { params: CommentParams });
  await service.deleteComment(params.itemId, params.commentId, id);
  res.status(204).end();
};
