import { Router } from 'express';
import { problemResponse } from '../../openapi/common.js';
import { registry } from '../../openapi/registry.js';
import { requireSession } from '../auth/index.js';
import { getProviders, getSeason, getTitle, recommendations, search } from './titles.controller.js';
import {
  SearchQuery,
  SeasonDetail,
  SeasonParams,
  TitleDetail,
  TitleParams,
  TitleSearchPage,
  WatchProviders,
} from './titles.schemas.js';

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
    'Primeira página do TMDB, em pt-BR/BR, sem conteúdo adulto. Cache em memória de 1 h.',
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

registry.registerPath({
  method: 'get',
  path: '/api/v1/titles/{mediaType}/{tmdbId}/providers',
  operationId: 'getTitleProviders',
  tags: ['titles'],
  summary: 'Onde assistir no Brasil: assinatura, aluguel e compra',
  description:
    'Região fixa BR. Sem dados para o Brasil, devolve listas vazias e `link: null`. Cache em memória de 24 h.',
  request: { params: TitleParams },
  responses: {
    200: {
      description: 'Provedores por modalidade.',
      content: { 'application/json': { schema: WatchProviders } },
    },
    400: invalid,
    401: unauthenticated,
    404: problemResponse('O TMDB não conhece o título (`TITLE_NOT_FOUND`).'),
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

export const titlesRouter: Router = Router();
titlesRouter.get('/recommendations', requireSession(), recommendations);
titlesRouter.get('/search', requireSession(), search);
titlesRouter.get('/TV/:tmdbId/seasons/:season', requireSession(), getSeason);
titlesRouter.get('/:mediaType/:tmdbId/providers', requireSession(), getProviders);
titlesRouter.get('/:mediaType/:tmdbId', requireSession(), getTitle);
