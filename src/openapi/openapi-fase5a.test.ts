import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers/app.js';

type Responses = Record<string, { content?: Record<string, unknown> }>;
type Paths = Record<string, Record<string, { operationId?: string; responses: Responses }>>;

async function fetchDocument() {
  const res = await request(testApp()).get('/api/v1/openapi.json');
  expect(res.status).toBe(200);
  return res.body as { paths: Paths; components?: { schemas?: Record<string, unknown> } };
}

describe('extras da Fase 5a no OpenAPI', () => {
  const L = '/api/v1/lists/{listId}/items';
  const EXPECTED: Record<string, string> = {
    [`get ${L}/random`]: 'randomItem',
    [`get ${L}/{itemId}/progress`]: 'listProgress',
    [`put ${L}/{itemId}/progress/me/episodes/{season}/{episode}`]: 'markEpisode',
    [`delete ${L}/{itemId}/progress/me/episodes/{season}/{episode}`]: 'unmarkEpisode',
    'get /api/v1/titles/{mediaType}/{tmdbId}/providers': 'getTitleProviders',
    'get /api/v1/titles/TV/{tmdbId}/seasons/{season}': 'getTitleSeason',
  };

  it('documenta as rotas com operationId e 401 problem+json', async () => {
    const document = await fetchDocument();
    for (const [key, operationId] of Object.entries(EXPECTED)) {
      const [method, path] = key.split(' ') as [string, string];
      const operation = document.paths[path]?.[method];
      expect(operation?.operationId, key).toBe(operationId);
      expect(operation?.responses['401']?.content, key).toHaveProperty('application/problem+json');
    }
  });

  it('publica os formatos de progresso, temporada, provedores e sorteio', async () => {
    const schemas = (await fetchDocument()).components?.schemas ?? {};
    for (const name of [
      'ProgressList',
      'MemberProgress',
      'WatchedEpisode',
      'SeasonDetail',
      'Episode',
      'WatchProviders',
      'WatchProvider',
      'RandomItem',
    ]) {
      expect(schemas[name], name).toBeDefined();
    }
  });
});
