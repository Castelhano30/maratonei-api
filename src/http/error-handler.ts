import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { AppError } from './app-error.js';
import { constraintCodes, type ErrorCode } from './error-codes.js';
import { sendProblem } from './problem.js';

/** Converte issues do Zod em `errors[{field, message}]` (campo em notação de ponto). */
export function zodFieldErrors(error: ZodError): { field: string; message: string }[] {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Extrai o nome da constraint de um erro conhecido do Prisma. Com o adapter-pg
 * o nome vem em `meta.driverAdapterError.cause.constraint`; os outros caminhos
 * cobrem o formato do engine clássico.
 */
export function constraintNameOf(error: Prisma.PrismaClientKnownRequestError): string | undefined {
  const meta = error.meta;
  if (!isRecord(meta)) return undefined;

  const adapterError = meta.driverAdapterError;
  const cause = isRecord(adapterError) ? adapterError.cause : undefined;
  if (isRecord(cause)) {
    const constraint = cause.constraint;
    if (isRecord(constraint)) {
      if (typeof constraint.index === 'string') return constraint.index;
      if (typeof constraint.name === 'string') return constraint.name;
    }
    if (typeof cause.originalMessage === 'string') {
      const match = /constraint "([^"]+)"/.exec(cause.originalMessage);
      if (match?.[1]) return match[1];
    }
  }
  for (const key of ['constraint', 'field_name', 'target'] as const) {
    if (typeof meta[key] === 'string') return meta[key];
  }
  return undefined;
}

const prismaFallbacks: Readonly<Record<string, ErrorCode>> = {
  P2002: 'CONSTRAINT_VIOLATION',
  P2003: 'CONSTRAINT_VIOLATION',
  P2025: 'RESOURCE_NOT_FOUND',
};

/** Traduz P2002/P2003/P2025 em `AppError`; outros erros do Prisma → `undefined`. */
export function fromPrismaError(error: unknown): AppError | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const fallback = prismaFallbacks[error.code];
  if (!fallback) return undefined;
  const constraint = error.code === 'P2025' ? undefined : constraintNameOf(error);
  const mapped = constraint ? constraintCodes[constraint] : undefined;
  return new AppError(mapped ?? fallback, { cause: error });
}

interface BodyParserError extends Error {
  type?: string;
  status?: number;
}

function fromBodyParserError(error: unknown): AppError | undefined {
  if (!(error instanceof Error)) return undefined;
  const { type, status } = error as BodyParserError;
  switch (type) {
    case 'entity.parse.failed':
      return new AppError('MALFORMED_JSON', 'O corpo da requisição não é um JSON válido.');
    case 'entity.too.large':
      return new AppError('PAYLOAD_TOO_LARGE');
    case 'charset.unsupported':
    case 'encoding.unsupported':
      return new AppError('UNSUPPORTED_MEDIA_TYPE');
    default:
      // Outros 4xx do body-parser (`request.size.invalid`, `request.aborted`...).
      if (typeof type === 'string' && typeof status === 'number' && status >= 400 && status < 500) {
        return new AppError('MALFORMED_JSON', 'O corpo da requisição não pôde ser lido.');
      }
      return undefined;
  }
}

/** Erro → `AppError`. Qualquer coisa não reconhecida vira 500 `INTERNAL_ERROR`. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) {
    return new AppError('VALIDATION_FAILED', { errors: zodFieldErrors(error), cause: error });
  }
  return (
    fromPrismaError(error) ??
    fromBodyParserError(error) ??
    new AppError('INTERNAL_ERROR', { cause: error })
  );
}

/** 404 para qualquer rota não registrada. Montado depois de todas as rotas. */
export const routeNotFound: RequestHandler = (_req, _res, next) => {
  next(new AppError('ROUTE_NOT_FOUND'));
};

/**
 * Error handler único (AD-13): tudo sai em `application/problem+json`. Um 500
 * nunca expõe stack nem mensagem interna; o erro original vai para o log com o
 * `requestId`.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const appError = toAppError(error);
  if (appError.status >= 500) {
    const original = appError.code === 'INTERNAL_ERROR' ? error : appError;
    req.log?.error({ err: original, code: appError.code }, 'request failed');
  }
  sendProblem(res, appError);
};
