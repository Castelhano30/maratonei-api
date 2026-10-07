import type { Request, RequestHandler } from 'express';
import { AppError } from './app-error.js';
import { SAFE_METHODS } from './origin-check.js';

function hasBody(req: Request): boolean {
  if (req.headers['transfer-encoding'] !== undefined) return true;
  const length = Number(req.headers['content-length'] ?? 0);
  return Number.isFinite(length) && length > 0;
}

/**
 * Corpos só em `application/json` (AD-5): uma mutação que traz corpo com outro
 * `Content-Type` recebe 415 `UNSUPPORTED_MEDIA_TYPE`.
 */
export const requireJson: RequestHandler = (req, _res, next) => {
  if (!SAFE_METHODS.has(req.method) && hasBody(req) && !req.is('application/json')) {
    next(new AppError('UNSUPPORTED_MEDIA_TYPE', 'O corpo deve ser application/json.'));
    return;
  }
  next();
};
