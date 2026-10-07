import type { Request } from 'express';
import type { z } from 'zod';
import { AppError, type FieldError } from './app-error.js';

type Schemas = {
  body?: z.ZodType;
  params?: z.ZodType;
  query?: z.ZodType;
};

type Parsed<S extends Schemas> = {
  [K in keyof S]: S[K] extends z.ZodType ? z.output<S[K]> : never;
};

/**
 * Valida `body`, `params` e `query` com os schemas registrados no OpenAPI e
 * devolve os valores já convertidos. Junta os erros das três partes num único
 * 400 `VALIDATION_FAILED` com `errors[{field, message}]`.
 */
export function validate<S extends Schemas>(
  req: Pick<Request, 'body' | 'params' | 'query'>,
  schemas: S,
): Parsed<S> {
  const output: Record<string, unknown> = {};
  const errors: FieldError[] = [];

  for (const part of ['params', 'query', 'body'] as const) {
    const schema = schemas[part];
    if (!schema) continue;
    const result = schema.safeParse(req[part]);
    if (result.success) {
      output[part] = result.data;
    } else {
      for (const issue of result.error.issues) {
        errors.push({
          field: issue.path.length > 0 ? issue.path.map(String).join('.') : part,
          message: issue.message,
        });
      }
    }
  }

  if (errors.length > 0) {
    throw new AppError('VALIDATION_FAILED', { errors });
  }
  return output as Parsed<S>;
}
