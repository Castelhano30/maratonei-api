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

    // Uma lista de exemplo, com o usuário como dono, sem duplicar na segunda execução.
    const lists = await prisma.list.findMany({ include: { members: true } });
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ name: 'Maratona de exemplo', ownerId: user?.id });
    expect(lists[0]?.members).toHaveLength(1);
    expect(lists[0]?.members[0]).toMatchObject({ userId: user?.id, role: 'OWNER' });

    // Dois itens de exemplo com títulos estáticos (sem TMDB), idempotentes.
    const items = await prisma.listItem.findMany({
      include: { title: true },
      orderBy: { title: { name: 'asc' } },
    });
    expect(items.map((item) => [item.title.name, item.title.mediaType, item.status])).toEqual([
      ['Dark', 'TV', 'WATCHING'],
      ['Duna', 'MOVIE', 'WANT'],
    ]);
    expect(items[0]?.title.seasons).toHaveLength(3);
    expect(items.every((item) => item.addedById === user?.id)).toBe(true);
    expect(await prisma.title.count()).toBe(2);

    // Uma nota e um comentário do dono no primeiro título, sem duplicar.
    const ratings = await prisma.rating.findMany({
      include: { listItem: { include: { title: true } } },
    });
    expect(ratings.map((r) => [r.listItem.title.name, r.stars])).toEqual([['Duna', 4]]);
    expect(await prisma.comment.count()).toBe(1);

    // Dois episódios assistidos pelo dono na série, sem duplicar.
    const progress = await prisma.episodeProgress.findMany({
      include: { listItem: { include: { title: true } } },
      orderBy: [{ season: 'asc' }, { episode: 'asc' }],
    });
    expect(progress.map((p) => [p.listItem.title.name, p.season, p.episode])).toEqual([
      ['Dark', 1, 1],
      ['Dark', 1, 2],
    ]);
  });

  it('recusa rodar com NODE_ENV=production', async () => {
    const result = await runSeed({ NODE_ENV: 'production' });
    expect(result.code).toBe(1);
    expect(result.output).toContain('production');
    expect(await prisma.user.count()).toBe(0);
  });

  it('recusa banco que não é local sem SEED_ALLOW_REMOTE=1', async () => {
    const result = await runSeed({
      DATABASE_URL: 'postgresql://u:p@ep-exemplo.neon.tech:5432/maratonei',
    });
    expect(result.code).toBe(1);
    expect(result.output).toContain('ep-exemplo.neon.tech');
    expect(result.output).toContain('SEED_ALLOW_REMOTE');
    expect(await prisma.user.count()).toBe(0);
  });

  it.each(['host', 'hostaddr'])('recusa ?%s= na connection string', async (param) => {
    const result = await runSeed({
      DATABASE_URL: `postgresql://u:p@localhost:5432/maratonei?${param}=ep-exemplo.neon.tech`,
    });
    expect(result.code).toBe(1);
    expect(result.output).toContain(param);
    expect(await prisma.user.count()).toBe(0);
  });

  it('com SEED_ALLOW_REMOTE=1 a guarda de host é liberada', async () => {
    // O host remoto não existe: o seed passa da guarda e falha só ao conectar.
    const result = await runSeed({
      DATABASE_URL: 'postgresql://u:p@host-inexistente.invalid:5432/maratonei',
      SEED_ALLOW_REMOTE: '1',
    });
    expect(result.code).toBe(1);
    expect(result.output).not.toContain('SEED_ALLOW_REMOTE');
  });
});
