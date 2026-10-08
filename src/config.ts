import { z } from 'zod';

const postgresUrl = z
  .string()
  .trim()
  .min(1, 'obrigatória')
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'postgres:' || url.protocol === 'postgresql:';
    } catch {
      return false;
    }
  }, 'deve ser uma URL postgres:// ou postgresql://');

/**
 * Normaliza uma origem (`scheme://host[:port]`). Rejeita qualquer valor que tenha
 * path, query, fragmento ou credenciais — uma origem não tem nada disso.
 */
export function normalizeOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' || /^[a-z]+:\/\/[^/]+\/./i.test(value)) return null;
  return url.origin;
}

const allowedOrigins = z
  .string()
  .trim()
  .min(1, 'obrigatória (lista de origens separadas por vírgula)')
  .transform((raw, ctx) => {
    const origins: string[] = [];
    for (const entry of raw.split(',')) {
      const candidate = entry.trim();
      if (!candidate) continue;
      const origin = normalizeOrigin(candidate);
      if (!origin) {
        ctx.addIssue({
          code: 'custom',
          message: 'cada item deve ser uma origem http(s)://host[:porta], sem path',
        });
        return z.NEVER;
      }
      origins.push(origin);
    }
    if (origins.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'informe ao menos uma origem' });
      return z.NEVER;
    }
    return [...new Set(origins)];
  });

const webOrigin = z
  .string()
  .trim()
  .min(1, 'obrigatória')
  .transform((raw, ctx) => {
    const origin = normalizeOrigin(raw);
    if (!origin) {
      ctx.addIssue({
        code: 'custom',
        message: 'deve ser uma origem http(s)://host[:porta], sem path',
      });
      return z.NEVER;
    }
    return origin;
  });

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: postgresUrl,
  DIRECT_DATABASE_URL: postgresUrl.optional(),
  ALLOWED_ORIGINS: allowedOrigins,
  // Origem pública do web: base dos links de e-mail e `baseURL` do Better Auth.
  WEB_ORIGIN: webOrigin,
  BETTER_AUTH_SECRET: z.string().trim().min(32, 'mínimo de 32 caracteres'),
  EMAIL_TRANSPORT: z.enum(['console']).default('console'),
});

export type Config = z.infer<typeof EnvSchema>;

/** Falha de configuração. Guarda só nomes de variáveis e mensagens, nunca valores. */
export class ConfigError extends Error {
  constructor(public readonly issues: ReadonlyArray<{ variable: string; message: string }>) {
    super(
      `Variáveis de ambiente inválidas: ${[...new Set(issues.map((i) => i.variable))].join(', ')}`,
    );
    this.name = 'ConfigError';
  }
}

/** Valida o ambiente. Lança `ConfigError` listando as variáveis inválidas. */
export function parseConfig(env: NodeJS.ProcessEnv): Config {
  // Variáveis vazias contam como ausentes (permite `DIRECT_DATABASE_URL=` no .env).
  const input = Object.fromEntries(
    Object.keys(EnvSchema.shape).map((key) => [key, env[key] === '' ? undefined : env[key]]),
  );
  const result = EnvSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => ({
        variable: String(issue.path[0] ?? '(raiz)'),
        // As mensagens do Zod e as nossas não incluem o valor recebido.
        message: issue.message,
      })),
    );
  }
  return result.data;
}

/** Valida no boot: em caso de erro, lista as variáveis no stderr e encerra com código 1. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  try {
    return parseConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      const lines = error.issues.map((issue) => `  - ${issue.variable}: ${issue.message}`);
      process.stderr.write(
        `Configuração inválida; corrija as variáveis de ambiente:\n${lines.join('\n')}\n`,
      );
      process.exit(1);
    }
    throw error;
  }
}

export const config: Config = loadConfig();
