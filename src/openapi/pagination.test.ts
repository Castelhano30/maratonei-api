import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers/app.js';

interface Schema {
  $ref?: string;
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
}
type Operation = {
  operationId?: string;
  responses: Record<string, { content?: Record<string, { schema?: Schema }> }>;
};
interface Doc {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
}

/**
 * Coleções `GET` que não são `Page<T>` porque o tamanho já é limitado por
 * `MAX_LIST_MEMBERS` (um registro por membro da lista: progresso e notas). Toda outra coleção
 * precisa ser paginada.
 */
const LIMITED_BY_MAX_LIST_MEMBERS = new Set(['listProgress', 'listRatings']);

/** `Page<T>` de página única e fixa (primeira página do TMDB): não aceita `page` na query. */
const FIXED_FIRST_PAGE = new Set(['getTitleRecommendations']);

const PAGE_FIELDS = ['data', 'page', 'pageSize', 'total'];

describe('paginação de toda coleção GET (NFR de desempenho)', () => {
  async function load(): Promise<Doc> {
    const res = await request(testApp()).get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    return res.body as Doc;
  }

  function resolve(doc: Doc, schema: Schema | undefined): Schema | undefined {
    if (!schema?.$ref) return schema;
    return doc.components.schemas[schema.$ref.replace('#/components/schemas/', '')];
  }

  function isCollection(doc: Doc, schema: Schema | undefined): boolean {
    const resolved = resolve(doc, schema);
    if (!resolved) return false;
    if (resolved.type === 'array') return true;
    return resolve(doc, resolved.properties?.data)?.type === 'array';
  }

  it('toda coleção é Page<T> ou está na lista explícita de limitadas', async () => {
    const doc = await load();
    const collections: string[] = [];
    const offenders: string[] = [];

    for (const [path, item] of Object.entries(doc.paths)) {
      const operation = item.get;
      if (!operation) continue;
      const schema = operation.responses['200']?.content?.['application/json']?.schema;
      if (!isCollection(doc, schema)) continue;
      const id = operation.operationId ?? `GET ${path}`;
      collections.push(id);
      const resolved = resolve(doc, schema);
      const isPage = PAGE_FIELDS.every((field) => field in (resolved?.properties ?? {}));
      if (!isPage && !LIMITED_BY_MAX_LIST_MEMBERS.has(id)) offenders.push(id);
    }

    expect(collections.length).toBeGreaterThanOrEqual(5);
    expect(offenders).toEqual([]);
    // A exceção declarada precisa existir de fato (evita lista obsoleta).
    for (const id of LIMITED_BY_MAX_LIST_MEMBERS) expect(collections).toContain(id);
  });

  it('as coleções paginadas aceitam page e pageSize na query', async () => {
    const doc = await load();
    for (const [path, item] of Object.entries(doc.paths)) {
      const operation = item.get as (Operation & { parameters?: { name: string }[] }) | undefined;
      if (!operation) continue;
      const schema = operation.responses['200']?.content?.['application/json']?.schema;
      const resolved = resolve(doc, schema);
      if (!isCollection(doc, schema)) continue;
      if (!PAGE_FIELDS.every((field) => field in (resolved?.properties ?? {}))) continue;
      if (FIXED_FIRST_PAGE.has(operation.operationId ?? '')) continue;
      const names = (operation.parameters ?? []).map((p) => p.name);
      // A busca do TMDB tem pageSize fixo (20); só aceita `page`.
      expect(names, `${path}`).toContain('page');
    }
  });
});
