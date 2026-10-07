import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConfigError, normalizeOrigin, parseConfig } from './config.js';

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/maratonei',
  ALLOWED_ORIGINS: 'http://localhost:3000',
};

function configErrorOf(env: NodeJS.ProcessEnv): ConfigError {
  try {
    parseConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('parseConfig deveria ter falhado');
}

describe('parseConfig (AD-16)', () => {
  it('aplica os padrões', () => {
    const config = parseConfig(validEnv);
    expect(config).toEqual({
      NODE_ENV: 'development',
      PORT: 4000,
      LOG_LEVEL: 'info',
      DATABASE_URL: validEnv.DATABASE_URL,
      ALLOWED_ORIGINS: ['http://localhost:3000'],
    });
  });

  it('normaliza e deduplica ALLOWED_ORIGINS', () => {
    const config = parseConfig({
      ...validEnv,
      ALLOWED_ORIGINS: ' https://Maratonei.App/ , http://localhost:3000,https://maratonei.app:443 ',
    });
    expect(config.ALLOWED_ORIGINS).toEqual(['https://maratonei.app', 'http://localhost:3000']);
  });

  it('aceita DIRECT_DATABASE_URL opcional e trata variável vazia como ausente', () => {
    expect(parseConfig({ ...validEnv, DIRECT_DATABASE_URL: '' }).DIRECT_DATABASE_URL).toBe(
      undefined,
    );
    const direct = 'postgres://u:p@db.neon.tech/maratonei';
    expect(parseConfig({ ...validEnv, DIRECT_DATABASE_URL: direct }).DIRECT_DATABASE_URL).toBe(
      direct,
    );
  });

  it('falha sem DATABASE_URL, listando a variável', () => {
    const error = configErrorOf({ ALLOWED_ORIGINS: validEnv.ALLOWED_ORIGINS });
    expect(error.issues.map((i) => i.variable)).toEqual(['DATABASE_URL']);
    expect(error.message).toContain('DATABASE_URL');
  });

  it.each([
    'localhost:3000',
    'http://localhost:3000/app',
    'http://localhost:3000?x=1',
    'ftp://files.example',
    'http://user:senha@localhost:3000',
    'http://localhost:3000,nao-e-origem',
    ' , ',
  ])('rejeita ALLOWED_ORIGINS=%j sem imprimir o valor', (value) => {
    const error = configErrorOf({ ...validEnv, ALLOWED_ORIGINS: value });
    expect(error.issues.map((i) => i.variable)).toEqual(['ALLOWED_ORIGINS']);
    const printed = `${error.message}\n${JSON.stringify(error.issues)}`;
    for (const part of value
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)) {
      expect(printed).not.toContain(part);
    }
  });

  it('lista todas as variáveis inválidas de uma vez', () => {
    const error = configErrorOf({
      DATABASE_URL: 'mysql://root:segredo@localhost/db',
      ALLOWED_ORIGINS: 'qualquer',
      PORT: 'abc',
      NODE_ENV: 'staging',
    });
    expect(new Set(error.issues.map((i) => i.variable))).toEqual(
      new Set(['DATABASE_URL', 'ALLOWED_ORIGINS', 'PORT', 'NODE_ENV']),
    );
    expect(JSON.stringify(error.issues)).not.toContain('segredo');
  });

  it('normalizeOrigin devolve só scheme://host[:porta]', () => {
    expect(normalizeOrigin('HTTP://LOCALHOST:3000/')).toBe('http://localhost:3000');
    expect(normalizeOrigin('https://a.example:443')).toBe('https://a.example');
    expect(normalizeOrigin('null')).toBeNull();
    expect(normalizeOrigin('https://a.example/x')).toBeNull();
  });
});

describe('boot com env inválida', () => {
  it('sai com código 1 listando as variáveis inválidas, sem imprimir valores', async () => {
    const require = createRequire(import.meta.url);
    const tsxLoader = pathToFileURL(require.resolve('tsx')).href;
    const secret = 'senha-super-secreta';

    const result = await new Promise<{ code: number | null; stderr: string; stdout: string }>(
      (resolve) => {
        execFile(
          process.execPath,
          ['--import', tsxLoader, 'src/server.ts'],
          {
            env: {
              ...process.env,
              DATABASE_URL: `mysql://root:${secret}@localhost/db`,
              ALLOWED_ORIGINS: `https://ok.example,javascript:${secret}`,
            },
            timeout: 30_000,
          },
          (error, stdout, stderr) => {
            const code = error ? (typeof error.code === 'number' ? error.code : null) : 0;
            resolve({ code, stderr, stdout });
          },
        );
      },
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('DATABASE_URL');
    expect(result.stderr).toContain('ALLOWED_ORIGINS');
    expect(result.stderr + result.stdout).not.toContain(secret);
    expect(result.stderr).not.toMatch(/at .*config\.ts/);
  });
});
