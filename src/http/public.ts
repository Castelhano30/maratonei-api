import type { RequestHandler } from 'express';
import { createLimiter, type RateLimitOptions } from './rate-limit.js';

/** Cabeçalho do 200 público (AD-19): navegador 1 min, CDN 1 h, e serve velho por até 24 h. */
export const PUBLIC_CACHE_CONTROL =
  'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400';

/** Chave única do balde global das rotas públicas. */
const PUBLIC_GLOBAL_KEY = 'public';

/**
 * Marca a resposta como pública e cacheável. Qualquer erro troca o cabeçalho por
 * `no-store` (`sendProblem`), então só o 200 fica com este valor.
 */
export const publicCacheControl: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', PUBLIC_CACHE_CONTROL);
  next();
};

/**
 * Guardas das rotas públicas, nesta ordem: cabeçalho de cache, teto por IP e teto global.
 * São montados por rota (não por `router.use`), para que `seasons` e `recommendations`, que
 * seguem com sessão, continuem só nos limitadores atuais.
 */
export function createPublicGuards(rateLimit: RateLimitOptions): RequestHandler[] {
  const guards: RequestHandler[] = [publicCacheControl];
  if (rateLimit.public) guards.push(createLimiter(rateLimit.public));
  if (rateLimit.publicGlobal) {
    guards.push(createLimiter({ ...rateLimit.publicGlobal, sharedKey: PUBLIC_GLOBAL_KEY }));
  }
  return guards;
}
