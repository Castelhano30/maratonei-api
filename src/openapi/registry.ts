import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Habilita `.openapi()` nos schemas Zod. Todo módulo que declara schemas
// importa `z` daqui, garantindo que a extensão rode antes.
extendZodWithOpenApi(z);

export { z };

/** Registry único do contrato (AD-2): toda rota registra request, response e erros aqui. */
export const registry = new OpenAPIRegistry();
