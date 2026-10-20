import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { config as defaultConfig, type Config } from './config.js';
import { errorHandler, routeNotFound } from './http/error-handler.js';
import { createHttpLogger, createLogger } from './http/logger.js';
import {
  createLimiter,
  createWriteLimiter,
  RATE_LIMIT_WINDOW_MS,
  type RateLimitOptions,
} from './http/rate-limit.js';
import { originCheck } from './http/origin-check.js';
import { rejectNul } from './http/reject-nul.js';
import { requireJson } from './http/require-json.js';
import { AUTH_BASE_PATH, createAuthHandler, meRouter } from './modules/auth/index.js';
import { commentsRouter } from './modules/comments/index.js';
import { healthRouter } from './modules/health/index.js';
import { invitesRouter, listInviteRouter } from './modules/invites/index.js';
import { itemsRouter } from './modules/items/index.js';
import { listsRouter } from './modules/lists/index.js';
import { membersRouter } from './modules/members/index.js';
import { progressRouter } from './modules/progress/index.js';
import { ratingsRouter } from './modules/ratings/index.js';
import { titlesRouter } from './modules/titles/index.js';
import { createDocsRouter, createOpenApiRouter, DOCS_PATH } from './openapi/openapi.routes.js';

export interface AppOptions {
  config?: Pick<Config, 'ALLOWED_ORIGINS' | 'LOG_LEVEL'>;
  logger?: Logger;
  /** Limites de taxa. Padrão: da config; desligados com NODE_ENV=test. */
  rateLimit?: RateLimitOptions;
}

function defaultRateLimit(): RateLimitOptions {
  if (defaultConfig.NODE_ENV === 'test') return {};
  const limiter = (limit: number) =>
    limit > 0 ? { limit, windowMs: RATE_LIMIT_WINDOW_MS } : undefined;
  const global = limiter(defaultConfig.RATE_LIMIT_GLOBAL_PER_MIN);
  const titles = limiter(defaultConfig.RATE_LIMIT_TITLES_PER_MIN);
  const auth = limiter(defaultConfig.RATE_LIMIT_AUTH_PER_MIN);
  return {
    ...(global ? { global } : {}),
    ...(titles ? { titles } : {}),
    ...(auth ? { auth } : {}),
  };
}

export const API_PREFIX = '/api/v1';

/**
 * Monta a aplicação. A ordem do pipeline é fixa (AD-13):
 * helmet → pino-http → origin-check → [auth handler] → json → /api/v1 → error handler.
 */
export function createApp(options: AppOptions = {}): Express {
  const config = options.config ?? defaultConfig;
  const logger = options.logger ?? createLogger(config);

  const rateLimit = options.rateLimit ?? defaultRateLimit();

  const app = express();
  // Nenhuma URL é derivada de Host/X-Forwarded-*; `trust proxy` só serve ao IP do rate limit.
  if (defaultConfig.TRUST_PROXY > 0) app.set('trust proxy', defaultConfig.TRUST_PROXY);

  app.use(helmet());
  app.use(createHttpLogger(logger));
  app.use(originCheck(config.ALLOWED_ORIGINS));

  // O limite do Better Auth lê X-Forwarded-For do cliente (contornável); este usa o IP do Express.
  if (rateLimit.auth) app.use(AUTH_BASE_PATH, createWriteLimiter(rateLimit.auth));

  // Better Auth: lê o corpo por conta própria, por isso entra antes do parser JSON (AD-6).
  app.all(`${AUTH_BASE_PATH}/*splat`, createAuthHandler());

  app.use(requireJson);
  app.use(express.json({ limit: '100kb' }));
  app.use(rejectNul);

  app.use(DOCS_PATH, createDocsRouter());

  const api = express.Router();
  api.use('/health', healthRouter);
  if (rateLimit.global) api.use(createLimiter(rateLimit.global));
  api.use('/me', meRouter);
  api.use('/lists', listsRouter);
  api.use('/lists/:listId/items/:itemId/ratings', ratingsRouter);
  api.use('/lists/:listId/items/:itemId/comments', commentsRouter);
  api.use('/lists/:listId/items/:itemId/progress', progressRouter);
  api.use('/lists/:listId/items', itemsRouter);
  api.use('/lists/:listId/members', membersRouter);
  api.use('/lists/:listId/invite', listInviteRouter);
  api.use('/invites', invitesRouter);
  if (rateLimit.titles) api.use('/titles', createLimiter(rateLimit.titles));
  api.use('/titles', titlesRouter);
  api.use(createOpenApiRouter());
  app.use(API_PREFIX, api);

  app.use(routeNotFound);
  app.use(errorHandler);

  return app;
}
