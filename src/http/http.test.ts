import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import type { Logger } from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApp } from '../app.js';
import { config } from '../config.js';
import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/prisma.js';
import { createUser } from '../../test/factories/index.js';
import { testApp } from '../../test/helpers/app.js';
import { allowedOrigin } from '../../test/helpers/as-user.js';
import { captureLogs } from '../../test/helpers/log-capture.js';
import { AppError } from './app-error.js';
import { ERROR_CODES, errorCodes } from './error-codes.js';
import {
  constraintNameOf,
  errorHandler,
  fromPrismaError,
  routeNotFound,
  toAppError,
} from './error-handler.js';
import { createHttpLogger, maskUrl } from './logger.js';
import { MAX_PAGE, PageQuery, toPage } from './pagination.js';
import { validate } from './validate.js';

const origin = allowedOrigin();

/** App mínima com o mesmo pipeline de erro/log da real, para rotas só de teste. */
function pipelineApp(register: (app: Express) => void, logger?: Logger): Express {
  const app = express();
  if (logger) app.use(createHttpLogger(logger));
  app.use(express.json());
  register(app);
  app.use(routeNotFound);
  app.use(errorHandler);
  return app;
}

function expectProblem(res: request.Response, status: number, code: string): void {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  expect(res.body).toMatchObject({ type: 'about:blank', status, code });
  expect(typeof res.body.title).toBe('string');
}

describe('origin-check (AD-5)', () => {
  it('rejeita mutação sem Origin com 403 ORIGIN_REJECTED', async () => {
    const res = await request(testApp()).post('/api/v1/health');
    expectProblem(res, 403, 'ORIGIN_REJECTED');
  });

  it.each(['https://evil.example', 'null', 'http://localhost:3000.evil.example'])(
    'rejeita mutação com Origin fora da lista (%s)',
    async (badOrigin) => {
      const res = await request(testApp()).delete('/api/v1/health').set('Origin', badOrigin);
      expectProblem(res, 403, 'ORIGIN_REJECTED');
    },
  );

  it('deixa passar mutação com Origin permitido; rota inexistente vira 404 ROUTE_NOT_FOUND', async () => {
    const res = await request(testApp()).post('/api/v1/qualquer').set('Origin', origin);
    expectProblem(res, 404, 'ROUTE_NOT_FOUND');
  });

  it('não exige Origin em GET, HEAD e OPTIONS', async () => {
    expect((await request(testApp()).get('/api/v1/health')).status).toBe(200);
    expect((await request(testApp()).head('/api/v1/health')).status).toBe(200);
    expect((await request(testApp()).options('/api/v1/health')).status).not.toBe(403);
  });

  it('responde 404 ROUTE_NOT_FOUND para GET em rota inexistente', async () => {
    const res = await request(testApp()).get('/api/v1/nao-existe');
    expectProblem(res, 404, 'ROUTE_NOT_FOUND');
  });
});

describe('corpo da requisição', () => {
  it('rejeita corpo que não é application/json com 415 UNSUPPORTED_MEDIA_TYPE', async () => {
    const res = await request(testApp())
      .post('/api/v1/qualquer')
      .set('Origin', origin)
      .set('Content-Type', 'text/plain')
      .send('oi');
    expectProblem(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejeita form-urlencoded com 415', async () => {
    const res = await request(testApp())
      .post('/api/v1/qualquer')
      .set('Origin', origin)
      .type('form')
      .send({ a: '1' });
    expectProblem(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('responde 400 MALFORMED_JSON para JSON inválido', async () => {
    const res = await request(testApp())
      .post('/api/v1/qualquer')
      .set('Origin', origin)
      .set('Content-Type', 'application/json')
      .send('{"nome": ');
    expectProblem(res, 400, 'MALFORMED_JSON');
  });

  it('responde 413 PAYLOAD_TOO_LARGE para JSON acima de 100 kb', async () => {
    const res = await request(testApp())
      .post('/api/v1/qualquer')
      .set('Origin', origin)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ texto: 'x'.repeat(101 * 1024) }));
    expectProblem(res, 413, 'PAYLOAD_TOO_LARGE');
  });

  it('rejeita application/json com charset não UTF-8 com 415', async () => {
    const res = await request(testApp())
      .post('/api/v1/qualquer')
      .set('Origin', origin)
      .set('Content-Type', 'application/json; charset=latin1')
      .send('{"a":1}');
    expectProblem(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejeita corpo chunked text/plain sem Content-Length com 415', async () => {
    const server = testApp().listen(0, '127.0.0.1');
    try {
      await new Promise((resolve) => server.once('listening', resolve));
      const { port } = server.address() as AddressInfo;
      const { status, contentType, body } = await new Promise<{
        status: number | undefined;
        contentType: string | undefined;
        body: string;
      }>((resolve, reject) => {
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port,
            method: 'POST',
            path: '/api/v1/qualquer',
            headers: {
              Origin: origin,
              'Content-Type': 'text/plain',
              'Transfer-Encoding': 'chunked',
            },
          },
          (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => (data += chunk));
            res.on('end', () =>
              resolve({
                status: res.statusCode,
                contentType: res.headers['content-type'],
                body: data,
              }),
            );
          },
        );
        req.on('error', reject);
        req.write('oi, ');
        req.end('tudo bem?');
      });
      expect(status).toBe(415);
      expect(contentType).toMatch(/^application\/problem\+json/);
      expect(JSON.parse(body)).toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('aceita mutação sem corpo e sem Content-Type', async () => {
    const res = await request(testApp()).delete('/api/v1/qualquer').set('Origin', origin);
    expectProblem(res, 404, 'ROUTE_NOT_FOUND');
  });
});

describe('validate()', () => {
  const Body = z.object({ name: z.string().min(1), stars: z.number().int().min(1).max(5) });
  const Params = z.object({ id: z.uuid() });
  const app = pipelineApp((a) => {
    a.post('/things/:id', (req, res) => {
      const { body, params } = validate(req, { body: Body, params: Params });
      res.json({ id: params.id, name: body.name, stars: body.stars });
    });
  });

  it('devolve os dados convertidos quando válidos', async () => {
    const id = randomUUID();
    const res = await request(app).post(`/things/${id}`).send({ name: 'Duna', stars: 5 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id, name: 'Duna', stars: 5 });
  });

  it('responde 400 VALIDATION_FAILED com errors[{field, message}]', async () => {
    const res = await request(app).post('/things/nao-uuid').send({ name: '', stars: 6 });
    expectProblem(res, 400, 'VALIDATION_FAILED');
    const fields = (res.body.errors as { field: string; message: string }[]).map((e) => e.field);
    expect(fields.sort()).toEqual(['id', 'name', 'stars']);
    for (const error of res.body.errors) expect(typeof error.message).toBe('string');
  });

  it('traduz um ZodError solto em 400 VALIDATION_FAILED', async () => {
    const zodApp = pipelineApp((a) => {
      a.get('/zod', () => {
        z.object({ q: z.string() }).parse({});
      });
    });
    const res = await request(zodApp).get('/zod');
    expectProblem(res, 400, 'VALIDATION_FAILED');
    expect(res.body.errors).toEqual([{ field: 'q', message: expect.any(String) }]);
  });
});

describe('paginação', () => {
  const app = pipelineApp((a) => {
    a.get('/items', (req, res) => {
      const { query } = validate(req, { query: PageQuery });
      res.json(toPage([], 0, query));
    });
  });

  it('usa page=1 e pageSize=20 por padrão', async () => {
    const res = await request(app).get('/items');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], page: 1, pageSize: 20, total: 0 });
  });

  it('aceita a última página cujo skip cabe em Int32', async () => {
    const res = await request(app).get(`/items?page=${MAX_PAGE}&pageSize=100`);
    expect(res.status).toBe(200);
    expect((MAX_PAGE - 1) * 100).toBeLessThanOrEqual(2_147_483_647);
  });

  it('aceita pageSize=100', async () => {
    const res = await request(app).get('/items?page=3&pageSize=100');
    expect(res.body).toMatchObject({ page: 3, pageSize: 100 });
  });

  it.each(['page=0', 'pageSize=101', 'pageSize=0', 'page=abc', 'page=1.5', `page=${MAX_PAGE + 1}`])(
    'rejeita %s com 400 VALIDATION_FAILED',
    async (qs) => {
      const res = await request(app).get(`/items?${qs}`);
      expectProblem(res, 400, 'VALIDATION_FAILED');
      expect(res.body.errors[0].field).toBe(qs.split('=')[0]);
    },
  );
});

describe('error handler', () => {
  it('responde 500 INTERNAL_ERROR sem stack nem mensagem interna, e loga com requestId', async () => {
    const { logger, lines } = captureLogs();
    const app = pipelineApp((a) => {
      a.get('/boom', async () => {
        throw new Error('segredo interno: senha do banco');
      });
    }, logger);

    const res = await request(app).get('/boom');

    expectProblem(res, 500, 'INTERNAL_ERROR');
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      code: 'INTERNAL_ERROR',
    });
    expect(res.text).not.toContain('segredo');
    expect(res.text).not.toMatch(/at .*\.ts/);

    const requestId = res.headers['x-request-id'];
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    const errorLine = lines.find((line) => line.msg === 'request failed');
    expect(errorLine).toMatchObject({ level: 50, requestId });
    expect(JSON.stringify(errorLine)).toContain('segredo interno');
  });

  it('traduz outros 4xx do body-parser em 400 MALFORMED_JSON', () => {
    for (const type of ['request.size.invalid', 'request.aborted']) {
      const error = Object.assign(new Error(type), { type, status: 400 });
      expect(toAppError(error)).toMatchObject({ code: 'MALFORMED_JSON', status: 400 });
    }
  });

  it('serializa AppError com detail', async () => {
    const app = pipelineApp((a) => {
      a.get('/list', () => {
        throw new AppError('LIST_NOT_FOUND', 'Lista não encontrada.');
      });
    });
    const res = await request(app).get('/list');
    expectProblem(res, 404, 'LIST_NOT_FOUND');
    expect(res.body.detail).toBe('Lista não encontrada.');
  });

  it('todo código do registro tem status HTTP de erro', () => {
    for (const code of ERROR_CODES) {
      expect(errorCodes[code]).toBeGreaterThanOrEqual(400);
      expect(new AppError(code).status).toBe(errorCodes[code]);
    }
  });
});

describe('erros do Prisma', () => {
  const app = pipelineApp((a) => {
    a.post('/dup', async (req, res) => {
      await prisma.user.create({ data: { name: 'Dup', email: req.body.email } });
      res.status(201).end();
    });
    a.post('/fk', async () => {
      await prisma.session.create({
        data: { userId: randomUUID(), token: randomUUID(), expiresAt: new Date() },
      });
    });
    a.post('/missing', async () => {
      await prisma.user.update({ where: { id: randomUUID() }, data: { name: 'x' } });
    });
  });

  it('P2002 (unique) → 409 com código genérico quando a constraint não está mapeada', async () => {
    const user = await createUser();
    const res = await request(app).post('/dup').send({ email: user.email });
    expectProblem(res, 409, 'CONSTRAINT_VIOLATION');
  });

  it('P2003 (FK) → 409 CONSTRAINT_VIOLATION', async () => {
    const res = await request(app).post('/fk');
    expectProblem(res, 409, 'CONSTRAINT_VIOLATION');
  });

  it('P2025 (registro não encontrado) → 404 RESOURCE_NOT_FOUND', async () => {
    const res = await request(app).post('/missing');
    expectProblem(res, 404, 'RESOURCE_NOT_FOUND');
  });

  it('extrai o nome da constraint dos erros reais do adapter-pg', async () => {
    const user = await createUser();
    const unique = await prisma.user
      .create({ data: { name: 'Dup', email: user.email } })
      .catch((error: unknown) => error);
    const fk = await prisma.session
      .create({ data: { userId: randomUUID(), token: randomUUID(), expiresAt: new Date() } })
      .catch((error: unknown) => error);

    expect(unique).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(constraintNameOf(unique as Prisma.PrismaClientKnownRequestError)).toBe('user_email_key');
    expect(constraintNameOf(fk as Prisma.PrismaClientKnownRequestError)).toBe(
      'session_user_id_fkey',
    );
  });

  it('usa o código mapeado pelo nome da constraint', () => {
    const error = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: Prisma.prismaVersion.client,
      meta: {
        driverAdapterError: {
          cause: {
            kind: 'UniqueConstraintViolation',
            constraint: { index: 'list_item_list_id_title_id_key' },
          },
        },
      },
    });
    const appError = fromPrismaError(error);
    expect(appError?.code).toBe('TITLE_ALREADY_IN_LIST');
    expect(appError?.status).toBe(409);
  });
});

describe('logs (pino-http)', () => {
  it('redige Cookie e Authorization como [Redacted]', async () => {
    const { logger, raw, lines } = captureLogs();
    const app = createApp({ config, logger });

    await request(app)
      .get('/api/v1/health')
      .set('Cookie', 'better-auth.session_token=cookie-secreto')
      .set('Authorization', 'Bearer token-secreto');

    const line = lines.find((l) => l.msg === 'request completed');
    const headers = (line?.req as { headers: Record<string, string> }).headers;
    expect(headers.cookie).toBe('[Redacted]');
    expect(headers.authorization).toBe('[Redacted]');
    expect(raw.join('\n')).not.toContain('secreto');
  });

  it('mascara tokens de convite e o parâmetro token na URL', async () => {
    const { logger, raw, lines } = captureLogs();
    const app = createApp({ config, logger });

    await request(app).get('/api/v1/invites/tok-convite-123?x=1');
    await request(app).get('/api/v1/auth/verify-email?token=tok-verificacao-456&callbackURL=/');

    const urls = lines.map((l) => (l.req as { url: string } | undefined)?.url);
    expect(urls).toContain('/api/v1/invites/[Redacted]?x=1');
    expect(urls).toContain('/api/v1/auth/verify-email?token=[Redacted]&callbackURL=/');
    expect(raw.join('\n')).not.toMatch(/tok-(convite|verificacao)/);
  });

  it('mascara tokens no header Referer', async () => {
    const { logger, raw, lines } = captureLogs();
    const app = createApp({ config, logger });

    await request(app)
      .get('/api/v1/health')
      .set('Referer', 'http://localhost:3000/convite/tok-referer-789?token=tok-query-000');

    const line = lines.find((l) => l.msg === 'request completed');
    const headers = (line?.req as { headers: Record<string, string> }).headers;
    expect(headers.referer).toBe('http://localhost:3000/convite/[Redacted]?token=[Redacted]');
    expect(raw.join('\n')).not.toMatch(/tok-(referer|query)/);
  });

  it('loga a resposta com level 40 em 4xx e 50 em 5xx', async () => {
    const { logger, lines } = captureLogs();
    const app = createApp({ config, logger });
    const responseLine = (status: number) =>
      lines.find((l) => (l.res as { statusCode?: number } | undefined)?.statusCode === status);

    await request(app).get('/api/v1/nao-existe');
    const spy = vi.spyOn(prisma, '$queryRaw').mockRejectedValue(new Error('banco fora'));
    try {
      await request(app).get('/api/v1/health/ready');
    } finally {
      spy.mockRestore();
    }

    expect(responseLine(404)).toMatchObject({ level: 40, msg: 'request completed' });
    // Em 5xx o pino-http usa a mensagem "request errored".
    expect(responseLine(503)).toMatchObject({ level: 50 });
  });

  it('maskUrl cobre reset de senha e preserva URLs sem token', () => {
    expect(maskUrl('/api/v1/auth/reset-password/abc?callbackURL=/x')).toBe(
      '/api/v1/auth/reset-password/[Redacted]?callbackURL=/x',
    );
    expect(maskUrl('/api/v1/lists?page=2')).toBe('/api/v1/lists?page=2');
  });

  it('devolve X-Request-Id único por requisição', async () => {
    const a = await request(testApp()).get('/api/v1/health');
    const b = await request(testApp()).get('/api/v1/health');
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
  });
});
