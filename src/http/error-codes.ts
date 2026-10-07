/**
 * Registro único dos códigos de erro da API (AD-12). Cada código tem um status
 * HTTP fixo. Este arquivo tipa o `AppError`, gera o enum de `Problem.code` no
 * OpenAPI e mapeia nomes de constraint do banco para códigos.
 *
 * O cliente trata `code` como um conjunto aberto: adicionar códigos é seguro,
 * remover ou renomear não (AD-3).
 */
export const errorCodes = {
  // 400
  VALIDATION_FAILED: 400,
  MALFORMED_JSON: 400,
  NOT_A_SERIES: 400,
  // 401
  UNAUTHENTICATED: 401,
  // 403
  ORIGIN_REJECTED: 403,
  INSUFFICIENT_ROLE: 403,
  NOT_OWN_RESOURCE: 403,
  OWNER_IMMUTABLE: 403,
  // 404
  ROUTE_NOT_FOUND: 404,
  RESOURCE_NOT_FOUND: 404,
  LIST_NOT_FOUND: 404,
  ITEM_NOT_FOUND: 404,
  MEMBER_NOT_FOUND: 404,
  COMMENT_NOT_FOUND: 404,
  INVITE_NOT_FOUND: 404,
  TITLE_NOT_FOUND: 404,
  // 409
  CONSTRAINT_VIOLATION: 409,
  TITLE_ALREADY_IN_LIST: 409,
  LIST_MEMBER_LIMIT: 409,
  // 413
  PAYLOAD_TOO_LARGE: 413,
  // 415
  UNSUPPORTED_MEDIA_TYPE: 415,
  // 429
  RATE_LIMITED: 429,
  // 500
  INTERNAL_ERROR: 500,
  // 503
  DB_UNAVAILABLE: 503,
  TMDB_UNAVAILABLE: 503,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof errorCodes;

export const ERROR_CODES = Object.keys(errorCodes) as [ErrorCode, ...ErrorCode[]];

export function statusOf(code: ErrorCode): number {
  return errorCodes[code];
}

/**
 * Nome da constraint (unique, FK) → código de erro. Uma violação sem entrada
 * aqui cai no código genérico (`CONSTRAINT_VIOLATION` ou `RESOURCE_NOT_FOUND`).
 * Os nomes seguem o padrão do Prisma: `<tabela>_<colunas>_key` / `_fkey`.
 */
export const constraintCodes: Readonly<Record<string, ErrorCode>> = {
  list_item_list_id_title_id_key: 'TITLE_ALREADY_IN_LIST',
};
