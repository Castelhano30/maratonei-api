import SwaggerParser from '@apidevtools/swagger-parser';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers/app.js';

type Operation = {
  operationId?: string;
  deprecated?: boolean;
  security?: unknown;
  parameters?: { name: string; in: string }[];
  responses: Record<string, unknown>;
};
interface Doc {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

async function loadDocument(): Promise<Doc> {
  const res = await request(testApp()).get('/api/v1/openapi.json');
  expect(res.status).toBe(200);
  return res.body as Doc;
}

/** Operações públicas da Fase 7: sem sessão, só leitura (AD-17, AD-19). */
const PUBLIC_OPERATIONS: Record<string, string> = {
  'get /api/v1/catalog/genres': 'listCatalogGenres',
  'get /api/v1/catalog/{mediaType}': 'listCatalog',
  'get /api/v1/titles/search': 'searchTitles',
  'get /api/v1/titles/{mediaType}/{tmdbId}': 'getTitle',
  'get /api/v1/titles/{mediaType}/{tmdbId}/providers': 'getTitleProviders',
};

describe('contrato OpenAPI da Fase 7a (AC-8.10)', () => {
  it('é um documento OpenAPI válido, com operationId únicos', async () => {
    const document = await loadDocument();
    await expect(SwaggerParser.validate(structuredClone(document) as never)).resolves.toBeDefined();

    const ids: string[] = [];
    for (const methods of Object.values(document.paths)) {
      for (const method of HTTP_METHODS) {
        const id = methods[method]?.operationId;
        if (methods[method]) ids.push(id ?? '(sem operationId)');
      }
    }
    expect(ids).not.toContain('(sem operationId)');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('operações públicas existem, não pedem segurança, não declaram 401 e declaram 429', async () => {
    const document = await loadDocument();
    for (const [key, operationId] of Object.entries(PUBLIC_OPERATIONS)) {
      const [method, path] = key.split(' ') as [string, string];
      const operation = document.paths[path]?.[method];
      expect(operation?.operationId, key).toBe(operationId);
      expect(operation?.security, key).toBeUndefined();
      expect(operation?.responses, key).not.toHaveProperty('401');
      expect(operation?.responses, key).toHaveProperty('429');
    }
  });

  it('CatalogCard e GenreList são componentes nomeados com os campos do contrato', async () => {
    const { components } = await loadDocument();
    expect(Object.keys(components.schemas.CatalogCard?.properties ?? {}).sort()).toEqual(
      [
        'genreIds',
        'latestSeason',
        'mediaType',
        'originCountry',
        'overview',
        'posterPath',
        'provider',
        'title',
        'tmdbId',
        'voteAverage',
        'voteCount',
        'year',
      ].sort(),
    );
    expect(components.schemas.GenreList).toBeDefined();
    expect(components.schemas.TitleDetail?.properties).toHaveProperty('voteAverage');
    expect(components.schemas.TitleDetail?.properties).toHaveProperty('voteCount');
  });

  it('WatchProvider é um componente único e não-nulo; só CatalogCard.provider aceita nulo', async () => {
    const { components } = await loadDocument();
    const schemas = components.schemas as Record<string, Record<string, unknown>>;
    expect(schemas.WatchProvider?.nullable).toBeUndefined();
    expect(JSON.stringify(schemas.CatalogCard?.properties)).toContain('"nullable":true');
    const provider = (schemas.CatalogCard?.properties as Record<string, unknown>).provider;
    expect(JSON.stringify(provider)).toContain('#/components/schemas/WatchProvider');
  });

  it('getTitleRecommendations está deprecated e as demais rotas de titles não', async () => {
    const { paths } = await loadDocument();
    expect(paths['/api/v1/titles/recommendations']?.get?.deprecated).toBe(true);
    expect(paths['/api/v1/titles/{mediaType}/{tmdbId}']?.get?.deprecated).toBeUndefined();
  });

  it('GET /lists documenta o parâmetro title', async () => {
    const { paths } = await loadDocument();
    const names = paths['/api/v1/lists']?.get?.parameters?.map((p) => p.name) ?? [];
    expect(names).toContain('title');
  });
});
