import { Router } from 'express';
import { requireListRole } from '../../http/access.js';
import { problemResponse } from '../../openapi/common.js';
import { registry } from '../../openapi/registry.js';
import { requireSession } from '../auth/index.js';
import { createList, deleteList, getList, listLists, updateList } from './lists.controller.js';
import {
  CreateListBody,
  ListDetail,
  ListIdParams,
  ListsQuery,
  ListSummaryPage,
  UpdateListBody,
} from './lists.schemas.js';

const unauthenticated = problemResponse('Sem sessão (`UNAUTHENTICATED`).');
const notFound = problemResponse('Lista inexistente ou usuário não membro (`LIST_NOT_FOUND`).');
const insufficient = (role: string) =>
  problemResponse(`Papel abaixo de ${role} (\`INSUFFICIENT_ROLE\`).`);
const invalid = problemResponse('Entrada inválida (`VALIDATION_FAILED`).');

registry.registerPath({
  method: 'get',
  path: '/api/v1/lists',
  operationId: 'listLists',
  tags: ['lists'],
  summary: 'Listas de que o usuário participa',
  request: { query: ListsQuery },
  responses: {
    200: {
      description: 'Página de listas, mais recentemente atualizadas primeiro.',
      content: { 'application/json': { schema: ListSummaryPage } },
    },
    400: invalid,
    401: unauthenticated,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/lists',
  operationId: 'createList',
  tags: ['lists'],
  summary: 'Cria uma lista; o criador vira OWNER',
  request: { body: { content: { 'application/json': { schema: CreateListBody } } } },
  responses: {
    201: {
      description: 'Lista criada.',
      content: { 'application/json': { schema: ListDetail } },
    },
    400: invalid,
    401: unauthenticated,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/lists/{listId}',
  operationId: 'getList',
  tags: ['lists'],
  summary: 'Detalhe da lista e papel do usuário (MEMBER)',
  request: { params: ListIdParams },
  responses: {
    200: { description: 'A lista.', content: { 'application/json': { schema: ListDetail } } },
    401: unauthenticated,
    404: notFound,
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/lists/{listId}',
  operationId: 'updateList',
  tags: ['lists'],
  summary: 'Renomeia a lista ou edita a descrição (EDITOR)',
  request: {
    params: ListIdParams,
    body: { content: { 'application/json': { schema: UpdateListBody } } },
  },
  responses: {
    200: {
      description: 'Lista atualizada.',
      content: { 'application/json': { schema: ListDetail } },
    },
    400: invalid,
    401: unauthenticated,
    403: insufficient('EDITOR'),
    404: notFound,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/lists/{listId}',
  operationId: 'deleteList',
  tags: ['lists'],
  summary: 'Exclui a lista com membros e convite (OWNER)',
  request: { params: ListIdParams },
  responses: {
    204: { description: 'Lista excluída.' },
    401: unauthenticated,
    403: insufficient('OWNER'),
    404: notFound,
  },
});

export const listsRouter: Router = Router();
listsRouter.get('/', requireSession(), listLists);
listsRouter.post('/', requireSession(), createList);
listsRouter.get('/:listId', requireSession(), requireListRole('MEMBER'), getList);
listsRouter.patch('/:listId', requireSession(), requireListRole('EDITOR'), updateList);
listsRouter.delete('/:listId', requireSession(), requireListRole('OWNER'), deleteList);
