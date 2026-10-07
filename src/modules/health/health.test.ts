import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { config } from '../../config.js';
import { prisma } from '../../lib/prisma.js';
import { captureLogs } from '../../../test/helpers/log-capture.js';
import { testApp } from '../../../test/helpers/app.js';
import { READINESS_TIMEOUT_MS } from './health.service.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/v1/health (liveness)', () => {
  it('responde 200 {status: "ok"}', async () => {
    const res = await request(testApp()).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('responde 200 com o banco fora e não faz nenhuma query', async () => {
    const queryRaw = vi
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
    const queryRawUnsafe = vi.spyOn(prisma, '$queryRawUnsafe');

    const res = await request(testApp()).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(queryRaw).not.toHaveBeenCalled();
    expect(queryRawUnsafe).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/health/ready (readiness)', () => {
  it('responde 200 com o banco no ar', async () => {
    const res = await request(testApp()).get('/api/v1/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('responde 503 DB_UNAVAILABLE quando a query falha, sem stack, e loga o erro', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:5432'),
    );
    const { logger, lines } = captureLogs();
    const app = createApp({ config, logger });

    const res = await request(app).get('/api/v1/health/ready');

    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Service Unavailable',
      status: 503,
      code: 'DB_UNAVAILABLE',
    });
    expect(res.text).not.toContain('ECONNREFUSED');
    expect(res.text).not.toContain('stack');

    const requestId = res.headers['x-request-id'];
    const errorLine = lines.find((line) => line.level === 50 && line.msg === 'request failed');
    expect(errorLine).toMatchObject({ requestId, code: 'DB_UNAVAILABLE' });
    expect(JSON.stringify(errorLine)).toContain('ECONNREFUSED');
  });

  it(`responde 503 DB_UNAVAILABLE quando o banco passa de ${READINESS_TIMEOUT_MS} ms`, async () => {
    vi.spyOn(prisma, '$queryRaw').mockReturnValue(
      new Promise(() => undefined) as ReturnType<typeof prisma.$queryRaw>,
    );

    const started = Date.now();
    const res = await request(testApp()).get('/api/v1/health/ready');
    const elapsed = Date.now() - started;

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('DB_UNAVAILABLE');
    expect(elapsed).toBeGreaterThanOrEqual(READINESS_TIMEOUT_MS - 50);
    expect(elapsed).toBeLessThan(READINESS_TIMEOUT_MS + 2000);
  });
});
