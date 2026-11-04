import type { RequestHandler } from 'express';
import { membershipOf } from '../../http/access.js';
import { validate } from '../../http/validate.js';
import { EpisodeParams } from './progress.schemas.js';
import * as service from './progress.service.js';
import { ListItemParams } from '../../openapi/common.js';

export const list: RequestHandler = async (req, res) => {
  const { listId } = membershipOf(req);
  const { params } = validate(req, { params: ListItemParams });
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
