import { Router } from 'express';
import { problemResponse } from '../../openapi/common.js';
import { registry } from '../../openapi/registry.js';
import { requireSession } from '../auth/index.js';
import { getTitle, search } from './titles.controller.js';
import { SearchQuery, TitleDetail, TitleParams, TitleSearchPage } from './titles.schemas.js';

const unauthenticated = problemResponse('Sem sessão (`UNAUTHENTICATED`).');
const invalid = problemResponse('Entrada inválida (`VALIDATION_FAILED`).');
const unavailable = problemResponse('TMDB fora, sem chave ou sem cache (`TMDB_UNAVAILABLE`).');

registry.registerPath({
  method: 'get',
  path: '/api/v1/titles/search',
  operationId: 'searchTitles',
  tags: ['titles'],
  summary: 'Busca filmes e séries por nome, em pt-BR (TMDB)',
  request: { query: SearchQuery },
  responses: {
    200: {
      description: 'Página de resultados (20 por página).',
      content: { 'application/json': { schema: TitleSearchPage } },
    },
    400: invalid,
    401: unauthenticated,
    503: unavailable,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/titles/{mediaType}/{tmdbId}',
  operationId: 'getTitle',
  tags: ['titles'],
  summary: 'Detalhe do título: sinopse, gêneros, elenco, duração ou temporadas e trailer',
  description:
    'Com o TMDB fora, serve o título em cache (sem elenco e trailer) se ele já estiver em alguma lista.',
  request: { params: TitleParams },
  responses: {
    200: { description: 'O título.', content: { 'application/json': { schema: TitleDetail } } },
    400: invalid,
    401: unauthenticated,
    404: problemResponse('O TMDB não conhece o título (`TITLE_NOT_FOUND`).'),
    503: unavailable,
  },
});

export const titlesRouter: Router = Router();
titlesRouter.get('/search', requireSession(), search);
titlesRouter.get('/:mediaType/:tmdbId', requireSession(), getTitle);
