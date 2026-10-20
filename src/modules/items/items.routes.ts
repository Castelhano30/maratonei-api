import { Router } from 'express';
import { requireListRole } from '../../http/access.js';
import { problemResponse } from '../../openapi/common.js';
import { registry } from '../../openapi/registry.js';
import { requireSession } from '../auth/index.js';
import { add, get, list, random, remove, setStatus } from './items.controller.js';
import {
  AddItemBody,
  ItemParams,
  ItemsQuery,
  ListItem,
  ListItemPage,
  ListParams,
  RandomItem,
  RandomQuery,
  SetItemStatusBody,
} from './items.schemas.js';

const unauthenticated = problemResponse('Sem sessão (`UNAUTHENTICATED`).');
const notFound = problemResponse('Lista inexistente ou usuário não membro (`LIST_NOT_FOUND`).');
const itemNotFound = problemResponse(
  'Lista (`LIST_NOT_FOUND`) ou item (`ITEM_NOT_FOUND`) inexistente; item de outra lista conta como inexistente.',
);
const invalid = problemResponse('Entrada inválida (`VALIDATION_FAILED`).');
const editorOnly = problemResponse('Papel abaixo de EDITOR (`INSUFFICIENT_ROLE`).');
const statusBody = { content: { 'application/json': { schema: SetItemStatusBody } } };

registry.registerPath({
  method: 'get',
  path: '/api/v1/lists/{listId}/items',
  operationId: 'listItems',
  tags: ['items'],
  summary: 'Itens da lista, com filtros por status, tipo e gênero (MEMBER)',
  request: { params: ListParams, query: ItemsQuery },
  responses: {
    200: {
      description: 'Página de itens, mais recentes primeiro por padrão.',
      content: { 'application/json': { schema: ListItemPage } },
    },
    400: invalid,
    401: unauthenticated,
    404: notFound,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/lists/{listId}/items/random',
  operationId: 'randomItem',
  tags: ['items'],
  summary: 'Sorteia um item pendente (`WANT`) da lista: "O que assistir hoje?" (MEMBER)',
  description: 'Sem itens pendentes (do tipo pedido), responde 200 com `data: null`.',
  request: { params: ListParams, query: RandomQuery },
  responses: {
    200: {
      description: 'O item sorteado ou `null`.',
      content: { 'application/json': { schema: RandomItem } },
    },
    400: invalid,
    401: unauthenticated,
    404: notFound,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/lists/{listId}/items',
  operationId: 'addItem',
  tags: ['items'],
  summary: 'Adiciona um título à lista (EDITOR)',
  request: {
    params: ListParams,
    body: { content: { 'application/json': { schema: AddItemBody } } },
  },
  responses: {
    201: { description: 'Item criado.', content: { 'application/json': { schema: ListItem } } },
    400: invalid,
    401: unauthenticated,
    403: editorOnly,
    404: problemResponse(
      'Lista inexistente ou usuário não membro (`LIST_NOT_FOUND`), ou título desconhecido do TMDB (`TITLE_NOT_FOUND`).',
    ),
    409: problemResponse('O título já está na lista (`TITLE_ALREADY_IN_LIST`).'),
    503: problemResponse('TMDB fora, sem chave ou sem cache do título (`TMDB_UNAVAILABLE`).'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/lists/{listId}/items/{itemId}',
  operationId: 'getItem',
  tags: ['items'],
  summary: 'Um item da lista (MEMBER)',
  request: { params: ItemParams },
  responses: {
    200: { description: 'O item.', content: { 'application/json': { schema: ListItem } } },
    400: invalid,
    401: unauthenticated,
    404: itemNotFound,
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/lists/{listId}/items/{itemId}/status',
  operationId: 'setItemStatus',
  tags: ['items'],
  summary: 'Altera o status coletivo do item (MEMBER; a última escrita prevalece)',
  request: { params: ItemParams, body: statusBody },
  responses: {
    200: { description: 'Item atualizado.', content: { 'application/json': { schema: ListItem } } },
    400: invalid,
    401: unauthenticated,
    404: itemNotFound,
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/lists/{listId}/items/{itemId}',
  operationId: 'patchItem',
  tags: ['items'],
  summary: 'Altera o status coletivo do item (MEMBER); equivale a `PUT .../status`',
  request: { params: ItemParams, body: statusBody },
  responses: {
    200: { description: 'Item atualizado.', content: { 'application/json': { schema: ListItem } } },
    400: invalid,
    401: unauthenticated,
    404: itemNotFound,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/lists/{listId}/items/{itemId}',
  operationId: 'removeItem',
  tags: ['items'],
  summary: 'Remove o item da lista (EDITOR)',
  request: { params: ItemParams },
  responses: {
    204: { description: 'Item removido.' },
    400: invalid,
    401: unauthenticated,
    403: editorOnly,
    404: itemNotFound,
  },
});

/**
 * Montado em `/lists/:listId/items`. Rotas estáticas (`/random`) entram antes de
 * `/:itemId`.
 */
export const itemsRouter: Router = Router({ mergeParams: true });
itemsRouter.get('/', requireSession(), requireListRole('MEMBER'), list);
itemsRouter.post('/', requireSession(), requireListRole('EDITOR'), add);
itemsRouter.get('/random', requireSession(), requireListRole('MEMBER'), random);
itemsRouter.get('/:itemId', requireSession(), requireListRole('MEMBER'), get);
itemsRouter.put('/:itemId/status', requireSession(), requireListRole('MEMBER'), setStatus);
itemsRouter.patch('/:itemId', requireSession(), requireListRole('MEMBER'), setStatus);
itemsRouter.delete('/:itemId', requireSession(), requireListRole('EDITOR'), remove);
