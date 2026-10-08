import { z } from '../../openapi/registry.js';

export const MeResponse = z
  .object({
    id: z.uuid(),
    name: z.string(),
    email: z.email(),
    image: z.string().nullable(),
  })
  .openapi('MeResponse', {
    description: 'Usuário da sessão atual. Nunca inclui hash, token ou chave.',
  });

export type MeResponse = z.infer<typeof MeResponse>;
