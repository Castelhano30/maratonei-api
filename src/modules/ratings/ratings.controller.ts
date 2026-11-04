import type { RequestHandler } from 'express';
import { membershipOf } from '../../http/access.js';
import { validate } from '../../http/validate.js';
import { SetRatingBody } from './ratings.schemas.js';
import * as service from './ratings.service.js';
import { ListItemParams } from '../../openapi/common.js';

export const list: RequestHandler = async (req, res) => {
  membershipOf(req);
  const { params } = validate(req, { params: ListItemParams });
  res.json(await service.listRatings(params.itemId));
};

export const setMine: RequestHandler = async (req, res) => {
  const { id } = membershipOf(req);
  const { params, body } = validate(req, { params: ListItemParams, body: SetRatingBody });
  res.json(await service.setOwnRating(params.itemId, id, body.stars));
};

export const removeMine: RequestHandler = async (req, res) => {
  const { id } = membershipOf(req);
  const { params } = validate(req, { params: ListItemParams });
  await service.removeOwnRating(params.itemId, id);
  res.status(204).end();
};
