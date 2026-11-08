import { Router } from 'express';
import { problemResponse } from '../../openapi/common.js';
import { registry } from '../../openapi/registry.js';
import { requireSession } from '../auth/index.js';
import { getSeason, recommendations } from './titles.controller.js';
import { SeasonDetail, SeasonParams, TitleSearchPage } from './titles.schemas.js';

const unauthenticated = problemResponse('Sem sessão (`UNAUTHENTICATED`).');
const invalid = problemResponse('Entrada inválida (`VALIDATION_FAILED`).');
const unavailable = problemResponse('TMDB fora, sem chave ou sem cache (`TMDB_UNAVAILABLE`).');

registry.registerPath({
  method: 'get',
  path: '/api/v1/titles/recommendations',
  operationId: 'getTitleRecommendations',
  tags: ['titles'],
  summary: 'Filmes populares para a próxima sessão',
  description:
    'Primeira página do TMDB, em pt-BR/BR, sem conteúdo adulto. Cache em memória de 1 h. Substituída pelas vitrines de `GET /catalog/MOVIE`; será removida só na v2.',
  deprecated: true,
  responses: {
    200: {
      description: 'Página de filmes populares.',
      content: { 'application/json': { schema: TitleSearchPage } },
    },
    401: unauthenticated,
    503: unavailable,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/titles/TV/{tmdbId}/seasons/{season}',
  operationId: 'getTitleSeason',
  tags: ['titles'],
  summary: 'Episódios de uma temporada da série',
  description: 'Cache em memória de 1 h; os episódios não são persistidos.',
  request: { params: SeasonParams },
  responses: {
    200: {
      description: 'A temporada e seus episódios.',
      content: { 'application/json': { schema: SeasonDetail } },
    },
    400: invalid,
    401: unauthenticated,
    404: problemResponse('Série ou temporada desconhecida do TMDB (`TITLE_NOT_FOUND`).'),
    503: unavailable,
  },
});

/**
 * Rotas de `titles` que seguem com sessão. As públicas (`search`, detalhe e provedores)
 * ficam em `titles.public.routes.ts`, montado antes dos limitadores atuais.
 */
export const titlesRouter: Router = Router();
titlesRouter.get('/recommendations', requireSession(), recommendations);
titlesRouter.get('/TV/:tmdbId/seasons/:season', requireSession(), getSeason);
