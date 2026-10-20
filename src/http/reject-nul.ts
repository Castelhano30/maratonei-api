import type { RequestHandler } from 'express';
import { AppError } from './app-error.js';

/**
 * O Postgres não aceita o byte NUL em texto; sem isto ele vira 500. Recusa antes de chegar ao
 * banco: URL (`%00`) e corpo JSON (`\u0000`) → 400 `VALIDATION_FAILED`.
 */
export const rejectNul: RequestHandler = (req, _res, next) => {
  const inUrl = /%00/i.test(req.originalUrl);
  // `JSON.stringify` escreve o NUL de uma string como a sequência de 6 caracteres `\u0000`.
  const inBody = req.body !== undefined && JSON.stringify(req.body).includes('\\u0000');
  next(
    inUrl || inBody
      ? new AppError('VALIDATION_FAILED', 'O texto contém um caractere inválido.')
      : undefined,
  );
};
