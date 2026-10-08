import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { config as defaultConfig, type Config } from './config.js';
import { errorHandler, routeNotFound } from './http/error-handler.js';
import { createHttpLogger, createLogger } from './http/logger.js';
import { originCheck } from './http/origin-check.js';
import { requireJson } from './http/require-json.js';
import { AUTH_BASE_PATH, createAuthHandler, meRouter } from './modules/auth/index.js';
import { healthRouter } from './modules/health/index.js';
import { createDocsRouter, createOpenApiRouter, DOCS_PATH } from './openapi/openapi.routes.js';

export interface AppOptions {
  config?: Pick<Config, 'ALLOWED_ORIGINS' | 'LOG_LEVEL'>;
  logger?: Logger;
}

export const API_PREFIX = '/api/v1';

/**
 * Monta a aplicação. A ordem do pipeline é fixa (AD-13):
 * helmet → pino-http → origin-check → [auth handler] → json → /api/v1 → error handler.
 */
export function createApp(options: AppOptions = {}): Express {
  const config = options.config ?? defaultConfig;
  const logger = options.logger ?? createLogger(config);

  const app = express();
  // Nenhuma URL é derivada de Host/X-Forwarded-*; `trust proxy` fica desligado até
  // as medições da Fase 0 (IP real atrás do rewrite).

  app.use(helmet());
  app.use(createHttpLogger(logger));
  app.use(originCheck(config.ALLOWED_ORIGINS));

  // Better Auth: lê o corpo por conta própria, por isso entra antes do parser JSON (AD-6).
  app.all(`${AUTH_BASE_PATH}/*splat`, createAuthHandler());

  app.use(requireJson);
  app.use(express.json({ limit: '100kb' }));

  app.use(DOCS_PATH, createDocsRouter());

  const api = express.Router();
  api.use('/health', healthRouter);
  api.use('/me', meRouter);
  api.use(createOpenApiRouter());
  app.use(API_PREFIX, api);

  app.use(routeNotFound);
  app.use(errorHandler);

  return app;
}
