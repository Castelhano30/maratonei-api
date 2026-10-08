import { Router } from 'express';
import { problemResponse } from '../../openapi/common.js';
import { registry } from '../../openapi/registry.js';
import { getMe } from './me.controller.js';
import { MeResponse } from './me.schemas.js';
import { requireSession } from './require-session.js';

registry.registerPath({
  method: 'get',
  path: '/api/v1/me',
  operationId: 'getMe',
  tags: ['auth'],
  summary: 'Usuário da sessão atual',
  responses: {
    200: {
      description: 'Usuário autenticado.',
      content: { 'application/json': { schema: MeResponse } },
    },
    401: problemResponse('Sem sessão ou sessão expirada (`UNAUTHENTICATED`).'),
  },
});

export const meRouter: Router = Router();
meRouter.get('/', requireSession(), getMe);
