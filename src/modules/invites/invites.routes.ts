import { Router } from 'express';
import { requireListRole } from '../../http/access.js';
import { problemResponse } from '../../openapi/common.js';
import { registry } from '../../openapi/registry.js';
import { requireSession } from '../auth/index.js';
import {
  acceptInvite,
  getInvite,
  previewInvite,
  revokeInvite,
  rotateInvite,
} from './invites.controller.js';
import { Invite, InviteListParams, InvitePreview, InviteTokenParams } from './invites.schemas.js';

const unauthenticated = problemResponse('Sem sessão (`UNAUTHENTICATED`).');
const notFound = problemResponse('Lista inexistente ou usuário não membro (`LIST_NOT_FOUND`).');
const invalid = problemResponse('Entrada inválida (`VALIDATION_FAILED`).');
const notOwner = problemResponse('Papel abaixo de OWNER (`INSUFFICIENT_ROLE`).');
const inviteNotFound = problemResponse('Token inexistente ou revogado (`INVITE_NOT_FOUND`).');
const listOrInviteNotFound = problemResponse(
  'Lista (`LIST_NOT_FOUND`) ou convite (`INVITE_NOT_FOUND`) inexistente.',
);

registry.registerPath({
  method: 'get',
  path: '/api/v1/lists/{listId}/invite',
  operationId: 'getListInvite',
  tags: ['invites'],
  summary: 'Convite ativo da lista (OWNER)',
  request: { params: InviteListParams },
  responses: {
    200: { description: 'Convite ativo.', content: { 'application/json': { schema: Invite } } },
    401: unauthenticated,
    403: notOwner,
    404: listOrInviteNotFound,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/lists/{listId}/invite',
  operationId: 'rotateListInvite',
  tags: ['invites'],
  summary: 'Gera o convite ou rotaciona, revogando o anterior (OWNER)',
  request: { params: InviteListParams },
  responses: {
    201: {
      description: 'Novo convite ativo.',
      content: { 'application/json': { schema: Invite } },
    },
    401: unauthenticated,
    403: notOwner,
    404: notFound,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/lists/{listId}/invite',
  operationId: 'revokeListInvite',
  tags: ['invites'],
  summary: 'Revoga o convite ativo (OWNER)',
  request: { params: InviteListParams },
  responses: {
    204: { description: 'Convite revogado.' },
    401: unauthenticated,
    403: notOwner,
    404: listOrInviteNotFound,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/invites/{token}',
  operationId: 'getInvite',
  tags: ['invites'],
  summary: 'Prévia do convite: nome da lista e se o usuário já é membro',
  request: { params: InviteTokenParams },
  responses: {
    200: { description: 'Prévia.', content: { 'application/json': { schema: InvitePreview } } },
    400: invalid,
    401: unauthenticated,
    404: inviteNotFound,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/invites/{token}/accept',
  operationId: 'acceptInvite',
  tags: ['invites'],
  summary: 'Aceita o convite (idempotente)',
  request: { params: InviteTokenParams },
  responses: {
    200: {
      description: 'O usuário é membro; `alreadyMember` indica se já era.',
      content: { 'application/json': { schema: InvitePreview } },
    },
    400: invalid,
    401: unauthenticated,
    404: inviteNotFound,
    409: problemResponse('Lista no limite de membros (`LIST_MEMBER_LIMIT`).'),
  },
});

/** Montado em `/lists/:listId/invite`. */
export const listInviteRouter: Router = Router({ mergeParams: true });
listInviteRouter.get('/', requireSession(), requireListRole('OWNER'), getInvite);
listInviteRouter.post('/', requireSession(), requireListRole('OWNER'), rotateInvite);
listInviteRouter.delete('/', requireSession(), requireListRole('OWNER'), revokeInvite);

/** Montado em `/invites`: exige só sessão (o token é a capacidade). */
export const invitesRouter: Router = Router();
invitesRouter.get('/:token', requireSession(), previewInvite);
invitesRouter.post('/:token/accept', requireSession(), acceptInvite);
