import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pino, type DestinationStream, type Logger } from 'pino';
import { pinoHttp, type StdSerializedResults } from 'pino-http';
import type { Config } from '../config.js';

type SerializedRequest = StdSerializedResults['req'];

export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
];

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Logger da aplicação, com redact de cookie, authorization e set-cookie (AD-13). */
export function createLogger(
  options: Pick<Config, 'LOG_LEVEL'>,
  destination?: DestinationStream,
): Logger {
  const loggerOptions = {
    level: options.LOG_LEVEL,
    redact: { paths: REDACT_PATHS },
  };
  return destination ? pino(loggerOptions, destination) : pino(loggerOptions);
}

const MASK = '[Redacted]';
const PATH_TOKEN = /(\/(?:invites|convite|reset-password)\/)[^/?#]+/gi;
const QUERY_TOKEN = /([?&]token=)[^&#]*/gi;

/** Mascara tokens de convite, reset e verificação na URL antes de logar. */
export function maskUrl(url: string): string {
  return url.replace(PATH_TOKEN, `$1${MASK}`).replace(QUERY_TOKEN, `$1${MASK}`);
}

/**
 * Middleware pino-http: gera o `requestId` (UUID, devolvido em `X-Request-Id`),
 * loga uma linha por resposta e expõe `req.log` com o `requestId` vinculado.
 */
export function createHttpLogger(logger: Logger) {
  return pinoHttp({
    logger,
    quietReqLogger: true,
    customAttributeKeys: { reqId: 'requestId' },
    genReqId: (_req: IncomingMessage, res: ServerResponse) => {
      const id = randomUUID();
      res.setHeader(REQUEST_ID_HEADER, id);
      return id;
    },
    customLogLevel: (_req, res, error) => {
      if (error || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {
      // Sem `query`/`params`: carregariam os tokens em claro; a URL mascarada basta.
      req: (req: SerializedRequest) => ({
        id: req.id,
        method: req.method,
        url: maskUrl(req.url),
        // O Referer pode trazer a URL de convite/reset de onde a requisição partiu.
        headers:
          typeof req.headers.referer === 'string'
            ? { ...req.headers, referer: maskUrl(req.headers.referer) }
            : req.headers,
        remoteAddress: req.remoteAddress,
        remotePort: req.remotePort,
      }),
      // Só o status: os headers de resposta são ruído (e `set-cookie` já é redigido).
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
    },
  });
}
