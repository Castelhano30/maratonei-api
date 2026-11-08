import { Router, type RequestHandler } from 'express';
import { problemResponse } from '../../openapi/common.js';
import { registry } from '../../openapi/registry.js';
import { getProviders, getTitle, search } from './titles.controller.js';
import {
  SearchQuery,
  TitleDetail,
  TitleParams,
  TitleSearchPage,
  WatchProviders,
} from './titles.schemas.js';

const invalid = problemResponse('Entrada inválida (`VALIDATION_FAILED`).');
const unavailable = problemResponse('TMDB fora, sem chave ou sem cache (`TMDB_UNAVAILABLE`).');
const rateLimited = problemResponse('Limite de requisições públicas excedido (`RATE_LIMITED`).');

registry.registerPath({
  method: 'get',
  path: '/api/v1/titles/search',
  operationId: 'searchTitles',
  tags: ['titles'],
  summary: 'Busca filmes e séries por nome, em pt-BR (TMDB). Pública.',
  request: { query: SearchQuery },
  responses: {
    200: {
      description: 'Página de resultados (20 por página).',
      content: { 'application/json': { schema: TitleSearchPage } },
    },
    400: invalid,
    429: rateLimited,
    503: unavailable,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/titles/{mediaType}/{tmdbId}',
  operationId: 'getTitle',
  tags: ['titles'],
  summary:
    'Detalhe do título: sinopse, gêneros, nota, elenco, duração ou temporadas e trailer. Pública.',
  description:
    'Somente leitura: nunca grava o título. Com o TMDB fora, serve a cópia em cache e, sem ela, o título já guardado em alguma lista (sem elenco e trailer).',
  request: { params: TitleParams },
  responses: {
    200: { description: 'O título.', content: { 'application/json': { schema: TitleDetail } } },
    400: invalid,
    404: problemResponse('O TMDB não conhece o título (`TITLE_NOT_FOUND`).'),
    429: rateLimited,
    503: unavailable,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/titles/{mediaType}/{tmdbId}/providers',
  operationId: 'getTitleProviders',
  tags: ['titles'],
  summary: 'Onde assistir no Brasil: assinatura, aluguel e compra. Pública.',
  description:
    'Região fixa BR. Sem dados para o Brasil, devolve listas vazias e `link: null`. Cache em memória de 24 h.',
  request: { params: TitleParams },
  responses: {
    200: {
      description: 'Provedores por modalidade.',
      content: { 'application/json': { schema: WatchProviders } },
    },
    400: invalid,
    404: problemResponse('O TMDB não conhece o título (`TITLE_NOT_FOUND`).'),
    429: rateLimited,
    503: unavailable,
  },
});

/**
 * Rotas públicas de `titles` (sem sessão, só leitura). As `guards` (cache público e limites
 * públicos) entram em cada rota, porque este router fica antes dos limitadores atuais e as
 * demais rotas de `/titles` (indicações e temporadas) não podem passar por eles.
 * As rotas estáticas vêm antes das com parâmetro (AD-13).
 */
export function createTitlesPublicRouter(guards: RequestHandler[]): Router {
  const router = Router();
  router.get('/search', ...guards, search);
  router.get('/:mediaType/:tmdbId/providers', ...guards, getProviders);
  router.get('/:mediaType/:tmdbId', ...guards, getTitle);
  return router;
}
