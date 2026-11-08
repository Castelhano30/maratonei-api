import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AppError } from './app-error.js';

export interface LimiterOptions {
  /** Requisições permitidas por janela e por IP. */
  limit: number;
  windowMs: number;
  /** Chave fixa em vez do IP: um único balde para todos (teto global das rotas públicas). */
  sharedKey?: string;
}

export interface RateLimitOptions {
  /** Teto de todo o `/api/v1` (exceto health). Não conta as rotas públicas. */
  global?: LimiterOptions;
  /** Teto extra de `/titles/*`, as rotas que tocam o TMDB. Não conta as rotas públicas. */
  titles?: LimiterOptions;
  /** Teto de escritas em `/auth/*` (login, cadastro, reset): barra força bruta por IP real. */
  auth?: LimiterOptions;
  /** Rotas públicas (catálogo e `titles` sem sessão): teto por IP. */
  public?: LimiterOptions;
  /** Rotas públicas: teto único (chave fixa) para todas juntas. */
  publicGlobal?: LimiterOptions;
}

export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Limitador por IP: acima do teto responde 429 `RATE_LIMITED` com `Retry-After`. */
export function createLimiter({ limit, windowMs, sharedKey }: LimiterOptions): RequestHandler {
  return rateLimit({
    limit,
    windowMs,
    ...(sharedKey === undefined ? {} : { keyGenerator: () => sharedKey }),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res, next) => {
      res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
      next(new AppError('RATE_LIMITED', 'Muitas requisições; tente novamente em instantes.'));
    },
  });
}

/** Como `createLimiter`, mas só conta métodos que escrevem (leitura de sessão não gasta o teto). */
export function createWriteLimiter(options: LimiterOptions): RequestHandler {
  const limiter = createLimiter(options);
  return (req, res, next) =>
    req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS'
      ? next()
      : limiter(req, res, next);
}
