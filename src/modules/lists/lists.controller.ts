import type { RequestHandler } from 'express';
import { AppError } from '../../http/app-error.js';
import { validate } from '../../http/validate.js';
import { CreateListBody, ListsQuery, UpdateListBody } from './lists.schemas.js';
import * as service from './lists.service.js';

export const listLists: RequestHandler = async (req, res) => {
  if (!req.user) throw new AppError('UNAUTHENTICATED');
  const { query } = validate(req, { query: ListsQuery });
  res.json(await service.listListsOf(req.user.id, query));
};

export const createList: RequestHandler = async (req, res) => {
  if (!req.user) throw new AppError('UNAUTHENTICATED');
  const { body } = validate(req, { body: CreateListBody });
  res.status(201).json(await service.createList(req.user.id, body));
};

export const getList: RequestHandler = async (req, res) => {
  const membership = req.membership;
  if (!membership) throw new AppError('LIST_NOT_FOUND');
  res.json(await service.getList(membership.listId, membership.role));
};

export const updateList: RequestHandler = async (req, res) => {
  const membership = req.membership;
  if (!membership) throw new AppError('LIST_NOT_FOUND');
  const { body } = validate(req, { body: UpdateListBody });
  res.json(await service.updateList(membership.listId, membership.role, body));
};

export const deleteList: RequestHandler = async (req, res) => {
  const membership = req.membership;
  if (!membership) throw new AppError('LIST_NOT_FOUND');
  await service.deleteList(membership.listId);
  res.status(204).end();
};
