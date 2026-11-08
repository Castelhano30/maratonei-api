import type { RequestHandler } from 'express';
import { validate } from '../../http/validate.js';
import { CatalogParams, CatalogQuery, GenresQuery } from './catalog.schemas.js';
import * as service from './catalog.service.js';

export const listGenres: RequestHandler = async (req, res) => {
  const { query } = validate(req, { query: GenresQuery });
  res.json(await service.listGenres(query.mediaType));
};

export const listCatalog: RequestHandler = async (req, res) => {
  const { params, query } = validate(req, { params: CatalogParams, query: CatalogQuery });
  res.json(await service.listCatalog(params.mediaType, query));
};
