import { STATUS_CODES } from 'node:http';
import type { Response } from 'express';
import type { AppError, FieldError } from './app-error.js';
import type { ErrorCode } from './error-codes.js';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Corpo RFC 9457 da API. `type` é sempre `about:blank`. */
export interface ProblemBody {
  type: 'about:blank';
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  errors?: FieldError[];
}

export function toProblem(error: AppError): ProblemBody {
  const body: ProblemBody = {
    type: 'about:blank',
    title: STATUS_CODES[error.status] ?? 'Error',
    status: error.status,
    code: error.code,
  };
  if (error.detail !== undefined) body.detail = error.detail;
  if (error.errors !== undefined) body.errors = error.errors;
  return body;
}

export function sendProblem(res: Response, error: AppError): void {
  res.status(error.status).type(PROBLEM_CONTENT_TYPE).json(toProblem(error));
}
