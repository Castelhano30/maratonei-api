import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import argon2 from 'argon2';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';

function runSeed(env: NodeJS.ProcessEnv = {}): Promise<{ code: number; output: string }> {
  const require = createRequire(import.meta.url);
  const tsx = pathToFileURL(require.resolve('tsx')).href;
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--import', tsx, 'prisma/seed.ts'],
      { env: { ...process.env, ...env }, timeout: 60_000 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({ code, output: stdout + stderr });
      },
    );
  });
}

describe('prisma/seed.ts', () => {
  it('cria o usuário verificado do E2E com credencial argon2id e é idempotente', async () => {
    expect((await runSeed()).code).toBe(0);
    expect((await runSeed({ SEED_E2E_PASSWORD: 'outra-senha' })).code).toBe(0);

    const users = await prisma.user.findMany({ include: { accounts: true } });
    expect(users).toHaveLength(1);
    const [user] = users;
    expect(user).toMatchObject({
      email: 'e2e@maratonei.local',
      name: 'Usuário E2E',
      emailVerified: true,
    });
    expect(user?.accounts).toHaveLength(1);
    const account = user?.accounts[0];
    expect(account).toMatchObject({ providerId: 'credential', accountId: user?.id });
    expect(account?.password).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(account?.password ?? '', 'outra-senha')).toBe(true);
  });

  it('recusa rodar com NODE_ENV=production', async () => {
    const result = await runSeed({ NODE_ENV: 'production' });
    expect(result.code).toBe(1);
    expect(result.output).toContain('production');
    expect(await prisma.user.count()).toBe(0);
  });
});
