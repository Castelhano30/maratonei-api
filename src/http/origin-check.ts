import type { RequestHandler } from 'express';
import { normalizeOrigin } from '../config.js';
import { AppError } from './app-error.js';

export const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF por verificação de origem (AD-5): todo método fora de GET/HEAD/OPTIONS
 * exige `Origin` presente e listado em `ALLOWED_ORIGINS`, senão 403
 * `ORIGIN_REJECTED`.
 */
export function originCheck(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const header = req.headers.origin;
    const origin = header ? normalizeOrigin(header) : null;
    if (!origin || !allowed.has(origin)) {
      next(new AppError('ORIGIN_REJECTED'));
      return;
    }
    next();
  };
}
