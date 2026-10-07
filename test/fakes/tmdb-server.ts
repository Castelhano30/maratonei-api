import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeTmdbRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
}

export interface FakeTmdbReply {
  status?: number;
  body?: unknown;
  /** Atraso antes de responder (para testar timeout). */
  delayMs?: number;
}

export type FakeTmdbHandler = (request: FakeTmdbRequest) => FakeTmdbReply | Promise<FakeTmdbReply>;

export interface FakeTmdbServer {
  /** Base para `TMDB_BASE_URL` (ex.: `http://127.0.0.1:54321/3`). */
  baseUrl: string;
  /** Requisições recebidas, em ordem. */
  requests: FakeTmdbRequest[];
  /** Registra a resposta para `METHOD /path` (path sem o prefixo `/3`). */
  on(method: string, path: string, handler: FakeTmdbHandler): void;
  reset(): void;
  close(): Promise<void>;
}

/**
 * Esqueleto do TMDB fake (AD-11): servidor HTTP real em porta efêmera. Rotas não
 * registradas respondem 404 no formato de erro do TMDB. As fases de títulos
 * registram aqui as respostas de busca, detalhe, temporadas e providers.
 */
export async function startFakeTmdb(): Promise<FakeTmdbServer> {
  const handlers = new Map<string, FakeTmdbHandler>();
  const requests: FakeTmdbRequest[] = [];

  const send = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'Content-Type': 'application/json;charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake-tmdb');
    const path = url.pathname.replace(/^\/3(?=\/)/, '');
    const request: FakeTmdbRequest = {
      method: req.method ?? 'GET',
      path,
      query: url.searchParams,
      headers: req.headers,
    };
    requests.push(request);

    const handler = handlers.get(`${request.method} ${path}`);
    if (!handler) {
      send(res, 404, {
        success: false,
        status_code: 34,
        status_message: 'The resource you requested could not be found.',
      });
      return;
    }
    Promise.resolve()
      .then(() => handler(request))
      .then(async (reply) => {
        if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
        send(res, reply.status ?? 200, reply.body ?? {});
      })
      .catch(() => send(res, 500, { success: false, status_message: 'fake error' }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}/3`,
    requests,
    on(method, path, handler) {
      handlers.set(`${method.toUpperCase()} ${path}`, handler);
    },
    reset() {
      handlers.clear();
      requests.length = 0;
    },
    close() {
      server.closeAllConnections();
      return new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
