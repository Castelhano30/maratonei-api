import SwaggerParser from '@apidevtools/swagger-parser';
import type { OpenAPI } from 'openapi-types';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../http/error-codes.js';
import { testApp } from '../../test/helpers/app.js';

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'] as const;

interface Operation {
  operationId?: string;
}

async function fetchDocument(): Promise<Record<string, unknown> & OpenAPI.Document> {
  const res = await request(testApp()).get('/api/v1/openapi.json');
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/^application\/json/);
  return res.body;
}

describe('GET /api/v1/openapi.json (CAP-1)', () => {
  it('é um OpenAPI 3.0.3 válido', async () => {
    const document = await fetchDocument();

    expect(document.openapi).toBe('3.0.3');
    expect(document.servers).toEqual([{ url: '/' }]);
    // validate() faz o parse, resolve as $refs e valida contra o schema do OpenAPI 3.0.
    await expect(SwaggerParser.validate(structuredClone(document))).resolves.toBeTruthy();
  });

  it('tem operationId em toda operação, todos únicos', async () => {
    const document = await fetchDocument();
    const paths = document.paths as Record<string, Partial<Record<string, Operation>>>;

    const ids: string[] = [];
    for (const [path, item] of Object.entries(paths)) {
      expect(path.startsWith('/api/v1/')).toBe(true);
      for (const method of METHODS) {
        const operation = item[method];
        if (!operation) continue;
        expect(operation.operationId, `${method.toUpperCase()} ${path}`).toBeTruthy();
        ids.push(operation.operationId as string);
      }
    }
    expect(ids).toEqual(expect.arrayContaining(['getHealth', 'getHealthReady']));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('publica os componentes compartilhados (UserSummary, Problem e enums)', async () => {
    const document = await fetchDocument();
    const schemas = (document.components as { schemas: Record<string, Record<string, unknown>> })
      .schemas;

    expect(schemas.UserSummary).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['id', 'name', 'image']),
    });
    expect(schemas.MediaType).toMatchObject({ enum: ['MOVIE', 'TV'] });
    expect(schemas.ItemStatus).toMatchObject({ enum: ['WANT', 'WATCHING', 'WATCHED'] });
    expect(schemas.ListRole).toMatchObject({ enum: ['OWNER', 'EDITOR', 'MEMBER'] });
    expect(schemas.Problem).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['type', 'title', 'status', 'code']),
    });
    // O enum de Problem.code nasce do registro central de códigos.
    expect((schemas.Problem as { properties: Record<string, unknown> }).properties.code).toEqual({
      $ref: '#/components/schemas/ErrorCode',
    });
    expect(schemas.ErrorCode).toMatchObject({ enum: [...ERROR_CODES] });
  });

  it('documenta o 503 do readiness como problem+json', async () => {
    const document = await fetchDocument();
    const ready = (document.paths as Record<string, Record<string, Record<string, unknown>>>)[
      '/api/v1/health/ready'
    ]?.get;
    expect(ready?.responses).toMatchObject({
      '503': {
        content: {
          'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } },
        },
      },
    });
  });
});

describe('superfície de auth no OpenAPI', () => {
  it('documenta getMe (200 MeResponse, 401 Problem) e nenhuma rota de auth', async () => {
    const document = await fetchDocument();
    const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>;

    expect(paths['/api/v1/me']?.get).toMatchObject({
      operationId: 'getMe',
      responses: {
        '200': {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/MeResponse' } } },
        },
        '401': {
          content: {
            'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } },
          },
        },
      },
    });
    const schemas = (document.components as { schemas: Record<string, { properties: object }> })
      .schemas;
    expect(Object.keys(schemas.MeResponse?.properties ?? {}).sort()).toEqual([
      'email',
      'id',
      'image',
      'name',
    ]);
    expect(Object.keys(paths).filter((path) => path.startsWith('/api/v1/auth'))).toEqual([]);
  });
});

describe('listas, membros e convites no OpenAPI', () => {
  const EXPECTED: Record<string, string> = {
    'get /api/v1/lists': 'listLists',
    'post /api/v1/lists': 'createList',
    'get /api/v1/lists/{listId}': 'getList',
    'patch /api/v1/lists/{listId}': 'updateList',
    'delete /api/v1/lists/{listId}': 'deleteList',
    'get /api/v1/lists/{listId}/members': 'listMembers',
    'delete /api/v1/lists/{listId}/members/me': 'leaveList',
    'delete /api/v1/lists/{listId}/members/{memberId}': 'removeMember',
    'put /api/v1/lists/{listId}/members/{memberId}/role': 'setMemberRole',
    'get /api/v1/lists/{listId}/invite': 'getListInvite',
    'post /api/v1/lists/{listId}/invite': 'rotateListInvite',
    'delete /api/v1/lists/{listId}/invite': 'revokeListInvite',
    'get /api/v1/invites/{token}': 'getInvite',
    'post /api/v1/invites/{token}/accept': 'acceptInvite',
  };

  it('documenta todas as rotas da Fase 2a com operationId e erros problem+json', async () => {
    const document = await fetchDocument();
    const paths = document.paths as Record<string, Record<string, Operation>>;

    for (const [key, operationId] of Object.entries(EXPECTED)) {
      const [method, path] = key.split(' ') as [string, string];
      const operation = paths[path]?.[method] as
        | (Operation & { responses: Record<string, { content?: Record<string, unknown> }> })
        | undefined;
      expect(operation?.operationId, key).toBe(operationId);
      expect(operation?.responses['401']?.content, key).toHaveProperty('application/problem+json');
    }
  });

  it('publica ListSummary, Member e Invite; listas e membros respondem Page<T>', async () => {
    const document = await fetchDocument();
    const schemas = (document.components as { schemas: Record<string, Record<string, unknown>> })
      .schemas;

    expect(schemas.ListSummary).toMatchObject({
      required: expect.arrayContaining([
        'id',
        'name',
        'description',
        'role',
        'memberCount',
        'itemCount',
        'createdAt',
        'updatedAt',
      ]),
    });
    expect(schemas.Member).toMatchObject({
      required: expect.arrayContaining(['id', 'user', 'role', 'joinedAt']),
    });
    expect(schemas.ListSummaryPage).toMatchObject({
      required: expect.arrayContaining(['data', 'page', 'pageSize', 'total']),
    });
    expect(schemas.MemberPage).toMatchObject({
      required: expect.arrayContaining(['data', 'page', 'pageSize', 'total']),
    });
  });
});

describe('títulos e itens no OpenAPI (Fase 3a)', () => {
  const EXPECTED: Record<string, string> = {
    'get /api/v1/titles/search': 'searchTitles',
    'get /api/v1/titles/{mediaType}/{tmdbId}': 'getTitle',
    'get /api/v1/lists/{listId}/items': 'listItems',
    'post /api/v1/lists/{listId}/items': 'addItem',
    'get /api/v1/lists/{listId}/items/{itemId}': 'getItem',
    'put /api/v1/lists/{listId}/items/{itemId}/status': 'setItemStatus',
    'patch /api/v1/lists/{listId}/items/{itemId}': 'patchItem',
    'delete /api/v1/lists/{listId}/items/{itemId}': 'removeItem',
  };

  it('documenta as rotas com operationId e 401 problem+json', async () => {
    const document = await fetchDocument();
    const paths = document.paths as Record<string, Record<string, Operation>>;

    for (const [key, operationId] of Object.entries(EXPECTED)) {
      const [method, path] = key.split(' ') as [string, string];
      const operation = paths[path]?.[method] as
        | (Operation & { responses: Record<string, { content?: Record<string, unknown> }> })
        | undefined;
      expect(operation?.operationId, key).toBe(operationId);
      expect(operation?.responses['401']?.content, key).toHaveProperty('application/problem+json');
    }
  });

  it('documenta os erros de domínio e os filtros de listItems', async () => {
    const document = await fetchDocument();
    const paths = document.paths as Record<
      string,
      Record<string, { responses: Record<string, unknown>; parameters?: { name: string }[] }>
    >;

    expect(Object.keys(paths['/api/v1/titles/search']?.get?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '400', '401', '503']),
    );
    expect(Object.keys(paths['/api/v1/lists/{listId}/items']?.post?.responses ?? {})).toEqual(
      expect.arrayContaining(['201', '403', '404', '409', '503']),
    );
    const params = paths['/api/v1/lists/{listId}/items']?.get?.parameters?.map((p) => p.name);
    expect(params).toEqual(
      expect.arrayContaining(['status', 'mediaType', 'genreId', 'sort', 'page', 'pageSize']),
    );
  });

  it('publica TitleSummary, TitleDetail e ListItem; itens respondem Page<T>', async () => {
    const document = await fetchDocument();
    const schemas = (document.components as { schemas: Record<string, Record<string, unknown>> })
      .schemas;

    expect(schemas.TitleSummary).toMatchObject({
      required: expect.arrayContaining([
        'tmdbId',
        'mediaType',
        'name',
        'overview',
        'posterPath',
        'releaseYear',
        'genreIds',
      ]),
    });
    expect(schemas.TitleDetail).toMatchObject({
      required: expect.arrayContaining(['genres', 'runtime', 'seasons', 'cast', 'trailer']),
    });
    expect(schemas.ListItem).toMatchObject({
      required: expect.arrayContaining([
        'id',
        'title',
        'status',
        'addedBy',
        'addedAt',
        'updatedAt',
        'ratingAverage',
        'ratingCount',
      ]),
    });
    for (const name of ['ListItemPage', 'TitleSearchPage']) {
      expect(schemas[name], name).toMatchObject({
        required: expect.arrayContaining(['data', 'page', 'pageSize', 'total']),
      });
    }
  });
});

describe('GET /docs (Swagger UI)', () => {
  it('responde 200 com o HTML do Swagger UI', async () => {
    const res = await request(testApp()).get('/docs');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.text).toContain('<div id="swagger-ui">');
    expect(res.text).toContain('src="/docs/swagger-ui-bundle.js"');
  });

  it('aponta para /api/v1/openapi.json e serve os assets', async () => {
    const init = await request(testApp()).get('/docs/swagger-ui-init.js');
    expect(init.status).toBe(200);
    expect(init.text).toContain('"swaggerUrl": "/api/v1/openapi.json"');

    const bundle = await request(testApp()).get('/docs/swagger-ui-bundle.js');
    expect(bundle.status).toBe(200);
    const css = await request(testApp()).get('/docs/swagger-ui.css');
    expect(css.status).toBe(200);
  });

  it('relaxa a CSP só em /docs', async () => {
    const docs = await request(testApp()).get('/docs');
    const api = await request(testApp()).get('/api/v1/health');

    const docsCsp = docs.headers['content-security-policy'];
    const apiCsp = api.headers['content-security-policy'];
    expect(docsCsp).toContain("style-src 'self' 'unsafe-inline'");
    expect(docsCsp).toContain("script-src 'self'");
    expect(docsCsp).not.toContain("'unsafe-eval'");
    // A API mantém a CSP padrão do helmet.
    expect(apiCsp).toContain("script-src-attr 'none'");
    expect(apiCsp).not.toBe(docsCsp);
  });
});
