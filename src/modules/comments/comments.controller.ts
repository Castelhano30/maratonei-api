import type { Request, RequestHandler } from 'express';
import { AppError } from '../../http/app-error.js';
import { validate } from '../../http/validate.js';
import { CommentBody, CommentParams, CommentsParams, CommentsQuery } from './comments.schemas.js';
import * as service from './comments.service.js';

function membershipOf(req: Request) {
  const membership = req.membership;
  if (!membership) throw new AppError('LIST_NOT_FOUND');
  return membership;
}

export const list: RequestHandler = async (req, res) => {
  membershipOf(req);
  const { params, query } = validate(req, { params: CommentsParams, query: CommentsQuery });
  res.json(await service.listComments(params.itemId, query));
};

export const create: RequestHandler = async (req, res) => {
  const { id } = membershipOf(req);
  const { params, body } = validate(req, { params: CommentsParams, body: CommentBody });
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
