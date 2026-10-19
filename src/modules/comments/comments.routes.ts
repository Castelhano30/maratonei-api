import { Router } from 'express';
import { requireItem, requireListRole } from '../../http/access.js';
import { problemResponse } from '../../openapi/common.js';
import { registry } from '../../openapi/registry.js';
import { requireSession } from '../auth/index.js';
import { create, list, remove, update } from './comments.controller.js';
import {
  Comment,
  CommentBody,
  CommentPage,
  CommentParams,
  CommentsParams,
  CommentsQuery,
} from './comments.schemas.js';

const unauthenticated = problemResponse('Sem sessão (`UNAUTHENTICATED`).');
const invalid = problemResponse('Entrada inválida (`VALIDATION_FAILED`).');
const notFound = problemResponse(
  'Lista inexistente ou usuário não membro (`LIST_NOT_FOUND`), ou item inexistente / de outra lista (`ITEM_NOT_FOUND`).',
);
const commentNotFound = problemResponse(
  'Lista (`LIST_NOT_FOUND`), item (`ITEM_NOT_FOUND`) ou comentário (`COMMENT_NOT_FOUND`) inexistente; comentário de outro item conta como inexistente.',
);
const notOwn = problemResponse('O comentário é de outro membro (`NOT_OWN_RESOURCE`).');
const bodyOf = { content: { 'application/json': { schema: CommentBody } } };

registry.registerPath({
  method: 'get',
  path: '/api/v1/lists/{listId}/items/{itemId}/comments',
  operationId: 'listComments',
  tags: ['comments'],
  summary: 'Comentários do item, paginados (MEMBER)',
  request: { params: CommentsParams, query: CommentsQuery },
  responses: {
    200: {
      description: 'Página de comentários, mais recentes primeiro por padrão.',
      content: { 'application/json': { schema: CommentPage } },
    },
    400: invalid,
    401: unauthenticated,
    404: notFound,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/lists/{listId}/items/{itemId}/comments',
  operationId: 'createComment',
  tags: ['comments'],
  summary: 'Comenta o item (MEMBER)',
  request: { params: CommentsParams, body: bodyOf },
  responses: {
    201: {
      description: 'Comentário criado.',
      content: { 'application/json': { schema: Comment } },
    },
    400: invalid,
    401: unauthenticated,
    404: notFound,
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/lists/{listId}/items/{itemId}/comments/{commentId}',
  operationId: 'updateComment',
  tags: ['comments'],
  summary: 'Edita o próprio comentário (MEMBER, só o autor)',
  request: { params: CommentParams, body: bodyOf },
  responses: {
    200: {
      description: 'Comentário atualizado.',
      content: { 'application/json': { schema: Comment } },
    },
    400: invalid,
    401: unauthenticated,
    403: notOwn,
    404: commentNotFound,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/lists/{listId}/items/{itemId}/comments/{commentId}',
  operationId: 'deleteComment',
  tags: ['comments'],
  summary: 'Exclui o próprio comentário (MEMBER, só o autor)',
  request: { params: CommentParams },
  responses: {
    204: { description: 'Comentário excluído.' },
    400: invalid,
    401: unauthenticated,
    403: notOwn,
    404: commentNotFound,
  },
});

/** Montado em `/lists/:listId/items/:itemId/comments`. */
export const commentsRouter: Router = Router({ mergeParams: true });
commentsRouter.use(requireSession(), requireListRole('MEMBER'), requireItem());
commentsRouter.get('/', list);
commentsRouter.post('/', create);
commentsRouter.patch('/:commentId', update);
commentsRouter.delete('/:commentId', remove);
