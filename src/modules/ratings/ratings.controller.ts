import type { Request, RequestHandler } from 'express';
import { AppError } from '../../http/app-error.js';
import { validate } from '../../http/validate.js';
import { RatingParams, SetRatingBody } from './ratings.schemas.js';
import * as service from './ratings.service.js';

function membershipOf(req: Request) {
  const membership = req.membership;
  if (!membership) throw new AppError('LIST_NOT_FOUND');
  return membership;
}

export const list: RequestHandler = async (req, res) => {
  membershipOf(req);
  const { params } = validate(req, { params: RatingParams });
  res.json(await service.listRatings(params.itemId));
};

export const setMine: RequestHandler = async (req, res) => {
  const { id } = membershipOf(req);
  const { params, body } = validate(req, { params: RatingParams, body: SetRatingBody });
  res.json(await service.setOwnRating(params.itemId, id, body.stars));
};

export const removeMine: RequestHandler = async (req, res) => {
  const { id } = membershipOf(req);
  const { params } = validate(req, { params: RatingParams });
  await service.removeOwnRating(params.itemId, id);
  res.status(204).end();
};
