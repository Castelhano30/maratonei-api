import { statusOf, type ErrorCode } from './error-codes.js';

export interface FieldError {
  field: string;
  message: string;
}

export interface AppErrorOptions {
  /** Explicação legível, segura para o cliente (nunca dados internos). */
  detail?: string;
  /** Erros por campo (`VALIDATION_FAILED`). */
  errors?: FieldError[];
  cause?: unknown;
}

/** Erro de domínio. O status HTTP vem do registro de códigos. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail?: string;
  readonly errors?: FieldError[];

  constructor(code: ErrorCode, detailOrOptions?: string | AppErrorOptions) {
    const options =
      typeof detailOrOptions === 'string' ? { detail: detailOrOptions } : (detailOrOptions ?? {});
    super(
      options.detail ?? code,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'AppError';
    this.code = code;
    this.status = statusOf(code);
    if (options.detail !== undefined) this.detail = options.detail;
    if (options.errors !== undefined) this.errors = options.errors;
  }
}
