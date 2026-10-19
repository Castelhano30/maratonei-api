import { Router } from 'express';
import { requireItem, requireListRole } from '../../http/access.js';
import { problemResponse } from '../../openapi/common.js';
import { registry } from '../../openapi/registry.js';
import { requireSession } from '../auth/index.js';
import { list, removeMine, setMine } from './ratings.controller.js';
import { Rating, RatingList, RatingParams, SetRatingBody } from './ratings.schemas.js';

const unauthenticated = problemResponse('Sem sessão (`UNAUTHENTICATED`).');
const invalid = problemResponse('Entrada inválida (`VALIDATION_FAILED`).');
const notFound = problemResponse(
  'Lista inexistente ou usuário não membro (`LIST_NOT_FOUND`), ou item inexistente / de outra lista (`ITEM_NOT_FOUND`).',
);

registry.registerPath({
  method: 'get',
  path: '/api/v1/lists/{listId}/items/{itemId}/ratings',
  operationId: 'listRatings',
  tags: ['ratings'],
  summary: 'Nota de cada membro e a média do item (MEMBER)',
  request: { params: RatingParams },
  responses: {
    200: { description: 'Notas e média.', content: { 'application/json': { schema: RatingList } } },
    400: invalid,
    401: unauthenticated,
    404: notFound,
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/lists/{listId}/items/{itemId}/ratings/me',
  operationId: 'setMyRating',
  tags: ['ratings'],
  summary: 'Cria ou edita a própria nota, de 1 a 5 estrelas (MEMBER)',
  request: {
    params: RatingParams,
    body: { content: { 'application/json': { schema: SetRatingBody } } },
  },
  responses: {
    200: {
      description: 'A nota do próprio membro.',
      content: { 'application/json': { schema: Rating } },
    },
    400: invalid,
    401: unauthenticated,
    404: notFound,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/lists/{listId}/items/{itemId}/ratings/me',
  operationId: 'removeMyRating',
  tags: ['ratings'],
  summary: 'Remove a própria nota; idempotente (MEMBER)',
  request: { params: RatingParams },
  responses: {
    204: { description: 'Nota removida (ou inexistente).' },
    400: invalid,
    401: unauthenticated,
    404: notFound,
  },
});

/** Montado em `/lists/:listId/items/:itemId/ratings`. */
export const ratingsRouter: Router = Router({ mergeParams: true });
ratingsRouter.use(requireSession(), requireListRole('MEMBER'), requireItem());
ratingsRouter.get('/', list);
ratingsRouter.put('/me', setMine);
ratingsRouter.delete('/me', removeMine);
