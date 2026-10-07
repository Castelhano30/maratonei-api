import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
export type OpenApiDocument = ReturnType<OpenApiGeneratorV3['generateDocument']>;
import { registry } from './registry.js';

export const OPENAPI_PATH = '/api/v1/openapi.json';

/**
 * Gera o documento OpenAPI 3.0.3 (maior compatibilidade com Orval e Swagger UI).
 * Servidor relativo: paths absolutos `/api/v1/...` funcionam atrás do rewrite do web.
 */
export function generateOpenApiDocument(): OpenApiDocument {
  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Maratonei API',
      version: '1.0.0',
      description:
        'API do Maratonei: listas compartilhadas de filmes e séries. Erros em application/problem+json.',
    },
    servers: [{ url: '/' }],
  });
}
