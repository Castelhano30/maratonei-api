import { z } from '../../openapi/registry.js';

export const HealthResponse = z
  .object({ status: z.literal('ok') })
  .openapi('HealthResponse', { description: 'A API está no ar (liveness, sem banco).' });

export const HealthReadyResponse = z
  .object({ status: z.literal('ok'), database: z.literal('up') })
  .openapi('HealthReadyResponse', { description: 'A API está pronta: o banco respondeu.' });

export type HealthResponse = z.infer<typeof HealthResponse>;
export type HealthReadyResponse = z.infer<typeof HealthReadyResponse>;
