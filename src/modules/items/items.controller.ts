import type { RequestHandler } from 'express';
import { membershipOf } from '../../http/access.js';
import { validate } from '../../http/validate.js';
import { AddItemBody, ItemsQuery, RandomQuery, SetItemStatusBody } from './items.schemas.js';
import * as service from './items.service.js';
import { ListIdParams, ListItemParams } from '../../openapi/common.js';

export const list: RequestHandler = async (req, res) => {
  const { listId } = membershipOf(req);
  const { query } = validate(req, { query: ItemsQuery });
  res.json(await service.listItems(listId, query));
};

export const random: RequestHandler = async (req, res) => {
  const { listId } = membershipOf(req);
  const { query } = validate(req, { params: ListIdParams, query: RandomQuery });
  res.json(await service.randomItem(listId, query));
};

export const add: RequestHandler = async (req, res) => {
  const { listId, userId } = membershipOf(req);
  const { body } = validate(req, { body: AddItemBody });
  res.status(201).json(await service.addItem(listId, userId, body));
};

export const get: RequestHandler = async (req, res) => {
  const { listId } = membershipOf(req);
  const { params } = validate(req, { params: ListItemParams });
  res.json(await service.getItem(listId, params.itemId));
};

export const remove: RequestHandler = async (req, res) => {
  const { listId } = membershipOf(req);
  const { params } = validate(req, { params: ListItemParams });
  await service.removeItem(listId, params.itemId);
  res.status(204).end();
};

export const setStatus: RequestHandler = async (req, res) => {
  const { listId } = membershipOf(req);
  const { params, body } = validate(req, { params: ListItemParams, body: SetItemStatusBody });
  res.json(await service.setItemStatus(listId, params.itemId, body.status));
};
