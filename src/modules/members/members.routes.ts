import { Router } from 'express';
import { requireListRole } from '../../http/access.js';
import { PageQuery } from '../../http/pagination.js';
import { problemResponse } from '../../openapi/common.js';
import { registry } from '../../openapi/registry.js';
import { requireSession } from '../auth/index.js';
import { ListIdParams } from '../lists/lists.schemas.js';
import { Member, MemberPage, MemberParams, SetRoleBody } from '../lists/index.js';
import { getMembers, leave, remove, setRole } from './members.controller.js';

const unauthenticated = problemResponse('Sem sessão (`UNAUTHENTICATED`).');
const notFound = problemResponse('Lista inexistente ou usuário não membro (`LIST_NOT_FOUND`).');
const invalid = problemResponse('Entrada inválida (`VALIDATION_FAILED`).');
const ownerOnly = problemResponse(
  'Papel insuficiente (`INSUFFICIENT_ROLE`) ou alvo é o dono (`OWNER_IMMUTABLE`).',
);
const listOrMemberNotFound = problemResponse(
  'Lista (`LIST_NOT_FOUND`) ou membro (`MEMBER_NOT_FOUND`) inexistente.',
);

registry.registerPath({
  method: 'get',
  path: '/api/v1/lists/{listId}/members',
  operationId: 'listMembers',
  tags: ['members'],
  summary: 'Membros da lista (MEMBER)',
  request: { params: ListIdParams, query: PageQuery },
  responses: {
    200: {
      description: 'Página de membros.',
      content: { 'application/json': { schema: MemberPage } },
    },
    400: invalid,
    401: unauthenticated,
    404: notFound,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/lists/{listId}/members/me',
  operationId: 'leaveList',
  tags: ['members'],
  summary: 'Sair da lista (MEMBER)',
  request: { params: ListIdParams },
  responses: {
    204: { description: 'Vínculo apagado, com notas, comentários e progresso do membro.' },
    401: unauthenticated,
    403: problemResponse('O dono não sai (`OWNER_IMMUTABLE`).'),
    404: notFound,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/lists/{listId}/members/{memberId}',
  operationId: 'removeMember',
  tags: ['members'],
  summary: 'Remove um membro (OWNER)',
  request: { params: MemberParams },
  responses: {
    204: { description: 'Membro removido.' },
    400: invalid,
    401: unauthenticated,
    403: ownerOnly,
    404: listOrMemberNotFound,
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/lists/{listId}/members/{memberId}/role',
  operationId: 'setMemberRole',
  tags: ['members'],
  summary: 'Concede ou revoga o papel de editor (OWNER)',
  request: {
    params: MemberParams,
    body: { content: { 'application/json': { schema: SetRoleBody } } },
  },
  responses: {
    200: {
      description: 'Membro atualizado.',
      content: { 'application/json': { schema: Member } },
    },
    400: invalid,
    401: unauthenticated,
    403: ownerOnly,
    404: listOrMemberNotFound,
  },
});

/** Montado em `/lists/:listId/members`; `members/me` vem antes de `:memberId`. */
export const membersRouter: Router = Router({ mergeParams: true });
membersRouter.get('/', requireSession(), requireListRole('MEMBER'), getMembers);
membersRouter.delete('/me', requireSession(), requireListRole('MEMBER'), leave);
membersRouter.delete('/:memberId', requireSession(), requireListRole('OWNER'), remove);
membersRouter.put('/:memberId/role', requireSession(), requireListRole('OWNER'), setRole);
