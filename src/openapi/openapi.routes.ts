import { Router } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { problemResponse } from './common.js';
import { generateOpenApiDocument, OPENAPI_PATH, type OpenApiDocument } from './document.js';
import { registry, z } from './registry.js';

export const DOCS_PATH = '/docs';

registry.registerPath({
  method: 'get',
  path: OPENAPI_PATH,
  operationId: 'getOpenApiDocument',
  tags: ['platform'],
  summary: 'Documento OpenAPI 3 da API',
  responses: {
    200: {
      description: 'Documento OpenAPI 3.0.3.',
      content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } },
    },
    500: problemResponse('Erro inesperado.'),
  },
});

/** Rotas do contrato, montadas sob `/api/v1`: `GET /openapi.json`. */
export function createOpenApiRouter(): Router {
  const router = Router();
  // Gerado no primeiro acesso: a essa altura todos os módulos já registraram suas rotas.
  let document: OpenApiDocument | undefined;
  router.get('/openapi.json', (_req, res) => {
    document ??= generateOpenApiDocument();
    res.json(document);
  });
  return router;
}

/**
 * Swagger UI em `/docs`, fora do prefixo. A CSP padrão do helmet vale para toda a
 * API; aqui ela é relaxada só o necessário para os assets do próprio Swagger UI
 * (`'unsafe-inline'` em estilo, `data:` em imagem).
 */
export function createDocsRouter(): Router {
  const router = Router();
  // O HTML do swagger-ui-express usa caminhos relativos (`./swagger-ui.css`), que
  // quebram em `/docs` sem barra final; trocamos por caminhos absolutos.
  const html = swaggerUi
    .generateHTML(undefined, {
      swaggerUrl: OPENAPI_PATH,
      customSiteTitle: 'Maratonei API — docs',
    })
    .replaceAll('"./', `"${DOCS_PATH}/`);

  router.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          imgSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
        },
      },
    }),
  );
  router.get('/', (_req, res) => {
    res.type('html').send(html);
  });
  router.use(swaggerUi.serve);
  return router;
}
