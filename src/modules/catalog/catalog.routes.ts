import { Router, type RequestHandler } from 'express';
import { GenreList, problemResponse } from '../../openapi/common.js';
import { registry } from '../../openapi/registry.js';
import { listCatalog, listGenres } from './catalog.controller.js';
import { CatalogPage, CatalogParams, CatalogQuery, GenresQuery } from './catalog.schemas.js';

const errors = {
  400: problemResponse('Entrada inválida (`VALIDATION_FAILED`).'),
  429: problemResponse('Limite de requisições públicas excedido (`RATE_LIMITED`).'),
  503: problemResponse('TMDB indisponível e sem cópia em cache (`TMDB_UNAVAILABLE`).'),
};

registry.registerPath({
  method: 'get',
  path: '/api/v1/catalog/genres',
  operationId: 'listCatalogGenres',
  tags: ['catalog'],
  summary: 'Lista pública de gêneros em pt-BR, por tipo de mídia.',
  request: { query: GenresQuery },
  responses: {
    200: {
      description: 'Gêneros, sem paginação.',
      content: { 'application/json': { schema: GenreList } },
    },
    ...errors,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/catalog/{mediaType}',
  operationId: 'listCatalog',
  tags: ['catalog'],
  summary: 'Catálogo público de filmes e séries, com filtros e ordenação.',
  description:
    'NOW_PLAYING aceita somente MOVIE; RECENT aceita somente TV. Página fixa de 20 itens; enriquecimento limitado aos 10 primeiros da página 1.',
  request: { params: CatalogParams, query: CatalogQuery },
  responses: {
    200: {
      description: 'Página do catálogo.',
      content: { 'application/json': { schema: CatalogPage } },
    },
    ...errors,
  },
});

export function createCatalogRouter(guards: RequestHandler[]): Router {
  const router = Router();
  router.get('/genres', ...guards, listGenres);
  router.get('/:mediaType', ...guards, listCatalog);
  return router;
}
