import { Router } from 'express';
import { problemResponse } from '../../openapi/common.js';
import { registry } from '../../openapi/registry.js';
import { getHealth, getHealthReady } from './health.controller.js';
import { HealthReadyResponse, HealthResponse } from './health.schemas.js';

registry.registerPath({
  method: 'get',
  path: '/api/v1/health',
  operationId: 'getHealth',
  tags: ['platform'],
  summary: 'Liveness: a API está no ar (não consulta o banco)',
  responses: {
    200: {
      description: 'A API está no ar.',
      content: { 'application/json': { schema: HealthResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/health/ready',
  operationId: 'getHealthReady',
  tags: ['platform'],
  summary: 'Readiness: a API e o banco estão prontos',
  responses: {
    200: {
      description: 'O banco respondeu a tempo.',
      content: { 'application/json': { schema: HealthReadyResponse } },
    },
    503: problemResponse('Banco indisponível ou lento (`DB_UNAVAILABLE`).'),
  },
});

export const healthRouter: Router = Router();
healthRouter.get('/', getHealth);
healthRouter.get('/ready', getHealthReady);
