import { Router } from 'express';
import { requireItem, requireListRole } from '../../http/access.js';
import { problemResponse } from '../../openapi/common.js';
import { registry } from '../../openapi/registry.js';
import { requireSession } from '../auth/index.js';
import { list, markMine, unmarkMine } from './progress.controller.js';
import { EpisodeParams, ProgressList, ProgressParams, WatchedEpisode } from './progress.schemas.js';

const unauthenticated = problemResponse('Sem sessão (`UNAUTHENTICATED`).');
const invalid = problemResponse(
  'Entrada inválida (`VALIDATION_FAILED`, inclusive temporada ou episódio inexistente na série) ou item que não é série (`NOT_A_SERIES`).',
);
const notFound = problemResponse(
  'Lista inexistente ou usuário não membro (`LIST_NOT_FOUND`), ou item inexistente / de outra lista (`ITEM_NOT_FOUND`).',
);

registry.registerPath({
  method: 'get',
  path: '/api/v1/lists/{listId}/items/{itemId}/progress',
  operationId: 'listProgress',
  tags: ['progress'],
  summary: 'Progresso de cada membro numa série (MEMBER)',
  description:
    'Um registro por membro da lista, em ordem de entrada, inclusive quem não marcou nada. O ponto atual é o maior `(season, episode)` marcado.',
  request: { params: ProgressParams },
  responses: {
    200: {
      description: 'Progresso por membro.',
      content: { 'application/json': { schema: ProgressList } },
    },
    400: invalid,
    401: unauthenticated,
    404: notFound,
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/lists/{listId}/items/{itemId}/progress/me/episodes/{season}/{episode}',
  operationId: 'markEpisode',
  tags: ['progress'],
  summary: 'Marca um episódio como assistido, só para si; idempotente (MEMBER)',
  description: 'Não altera o status coletivo do item.',
  request: { params: EpisodeParams },
  responses: {
    200: {
      description: 'O episódio marcado.',
      content: { 'application/json': { schema: WatchedEpisode } },
    },
    400: invalid,
    401: unauthenticated,
    404: notFound,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/lists/{listId}/items/{itemId}/progress/me/episodes/{season}/{episode}',
  operationId: 'unmarkEpisode',
  tags: ['progress'],
  summary: 'Desmarca um episódio do próprio progresso; idempotente (MEMBER)',
  request: { params: EpisodeParams },
  responses: {
    204: { description: 'Episódio desmarcado (ou já não marcado).' },
    400: invalid,
    401: unauthenticated,
    404: notFound,
  },
});

/** Montado em `/lists/:listId/items/:itemId/progress`. */
export const progressRouter: Router = Router({ mergeParams: true });
progressRouter.use(requireSession(), requireListRole('MEMBER'), requireItem());
progressRouter.get('/', list);
progressRouter.put('/me/episodes/:season/:episode', markMine);
progressRouter.delete('/me/episodes/:season/:episode', unmarkMine);
