import type { Request, RequestHandler } from 'express';
import { AppError } from '../../http/app-error.js';
import { validate } from '../../http/validate.js';
import { EpisodeParams, ProgressParams } from './progress.schemas.js';
import * as service from './progress.service.js';

function membershipOf(req: Request) {
  const membership = req.membership;
  if (!membership) throw new AppError('LIST_NOT_FOUND');
  return membership;
}

export const list: RequestHandler = async (req, res) => {
  const { listId } = membershipOf(req);
  const { params } = validate(req, { params: ProgressParams });
  res.json(await service.listProgress(listId, params.itemId));
};

export const markMine: RequestHandler = async (req, res) => {
  const { listId, id } = membershipOf(req);
  const { params } = validate(req, { params: EpisodeParams });
  res.json(await service.markEpisode(listId, params.itemId, id, params.season, params.episode));
};

export const unmarkMine: RequestHandler = async (req, res) => {
  const { listId, id } = membershipOf(req);
  const { params } = validate(req, { params: EpisodeParams });
  await service.unmarkEpisode(listId, params.itemId, id, params.season, params.episode);
  res.status(204).end();
};
