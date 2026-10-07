import { AppError } from '../../http/app-error.js';
import { prisma } from '../../lib/prisma.js';
import type { HealthReadyResponse, HealthResponse } from './health.schemas.js';

export const READINESS_TIMEOUT_MS = 2000;

/** Liveness: nunca toca o banco (o monitor externo não pode acordar o Neon, AD-16). */
export function getLiveness(): HealthResponse {
  return { status: 'ok' };
}

/**
 * Readiness: `SELECT 1` com timeout. Falha ou demora acima do limite viram
 * 503 `DB_UNAVAILABLE`; a causa vai só para o log.
 */
export async function getReadiness(
  timeoutMs: number = READINESS_TIMEOUT_MS,
): Promise<HealthReadyResponse> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`O banco não respondeu em ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
  } catch (error) {
    throw new AppError('DB_UNAVAILABLE', { cause: error });
  } finally {
    clearTimeout(timer);
  }
  return { status: 'ok', database: 'up' };
}
