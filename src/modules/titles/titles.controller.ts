import type { RequestHandler } from 'express';
import { validate } from '../../http/validate.js';
import { SearchQuery, SeasonParams, TitleParams } from './titles.schemas.js';
import * as service from './titles.service.js';

export const search: RequestHandler = async (req, res) => {
  const { query } = validate(req, { query: SearchQuery });
  res.json(await service.searchTitles(query.q, query.page));
};

export const getSeason: RequestHandler = async (req, res) => {
  const { params } = validate(req, { params: SeasonParams });
  res.json(await service.getSeason(params.tmdbId, params.season));
};

export const getProviders: RequestHandler = async (req, res) => {
  const { params } = validate(req, { params: TitleParams });
  res.json(await service.getProviders(params.mediaType, params.tmdbId));
};

export const getTitle: RequestHandler = async (req, res) => {
  const { params } = validate(req, { params: TitleParams });
  res.json(await service.getTitleDetail(params.mediaType, params.tmdbId));
};
