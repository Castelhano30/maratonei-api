/**
 * Mede o p95 das rotas principais contra a API local (NFR: p95 < 500 ms, exceto TMDB).
 *
 * Uso (API rodando com os limites de taxa desligados):
 *   RATE_LIMIT_GLOBAL_PER_MIN=0 RATE_LIMIT_TITLES_PER_MIN=0 pnpm dev
 *   pnpm perf:check            # PERF_BASE_URL, PERF_ITEMS e PERF_SAMPLES ajustam a medição
 *
 * Semeia usuários, uma lista com itens, notas, comentários e progresso no banco de DATABASE_URL,
 * mede e remove tudo no fim. Recusa banco que não seja local.
 */
import 'dotenv/config';
import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const BASE_URL = process.env.PERF_BASE_URL ?? 'http://localhost:4000';
const ITEMS = Number(process.env.PERF_ITEMS ?? 200);
const SAMPLES = Number(process.env.PERF_SAMPLES ?? 100);
const BUDGET_MS = 500;
const COOKIE_NAME = 'better-auth.session_token';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'db', 'postgres']);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} não definida.`);
  return value;
}

function p95(sorted: number[]): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

async function main(): Promise<void> {
  const connectionString = requireEnv('DATABASE_URL');
  const secret = requireEnv('BETTER_AUTH_SECRET');
  const host = new URL(connectionString).hostname.toLowerCase();
  if (!LOCAL_HOSTS.has(host)) throw new Error(`perf-check recusa o banco "${host}" (não é local).`);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const tag = randomBytes(4).toString('hex');
  const tmdbBase = 1_000_000_000 + randomInt(0, 900_000_000);
  let listId: string | undefined;
  const userIds: string[] = [];
  const titleIds: string[] = [];

  try {
    const users = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        prisma.user.create({
          data: {
            name: `Perf ${i}`,
            email: `perf-${tag}-${i}@maratonei.test`,
            emailVerified: true,
          },
        }),
      ),
    );
    userIds.push(...users.map((u) => u.id));
    const owner = users[0]!;
    const list = await prisma.list.create({
      data: { name: `Perf ${tag}`, ownerId: owner.id },
    });
    listId = list.id;
    const members = await Promise.all(
      users.map((u, i) =>
        prisma.listMember.create({
          data: { listId: list.id, userId: u.id, role: i === 0 ? 'OWNER' : 'MEMBER' },
        }),
      ),
    );

    const statuses = ['WANT', 'WATCHING', 'WATCHED'] as const;
    let seriesItemId = '';
    let firstItemId = '';
    for (let i = 0; i < ITEMS; i++) {
      const isTv = i % 4 === 0;
      const title = await prisma.title.create({
        data: {
          tmdbId: tmdbBase + i,
          mediaType: isTv ? 'TV' : 'MOVIE',
          name: `Título de desempenho ${i}`,
          overview: 'Sinopse de teste.',
          genreIds: [18, 35],
          genres: ['Drama', 'Comédia'],
          runtime: isTv ? null : 110,
          ...(isTv ? { seasons: [{ season: 1, episodeCount: 10 }] } : {}),
        },
      });
      titleIds.push(title.id);
      const item = await prisma.listItem.create({
        data: {
          listId: list.id,
          titleId: title.id,
          addedById: owner.id,
          status: statuses[i % 3]!,
        },
      });
      if (i === 0) firstItemId = item.id;
      if (isTv && !seriesItemId) seriesItemId = item.id;
      for (const m of members) {
        await prisma.rating.create({
          data: { listItemId: item.id, memberId: m.id, stars: 1 + (i % 5) },
        });
      }
      if (i < 50) {
        await prisma.comment.createMany({
          data: members.map((m) => ({ listItemId: item.id, memberId: m.id, body: 'Comentário.' })),
        });
      }
    }
    for (const m of members) {
      await prisma.episodeProgress.createMany({
        data: Array.from({ length: 10 }, (_, e) => ({
          listItemId: seriesItemId,
          memberId: m.id,
          season: 1,
          episode: e + 1,
        })),
      });
    }

    const session = await prisma.session.create({
      data: {
        userId: owner.id,
        token: randomBytes(32).toString('base64url'),
        expiresAt: new Date(Date.now() + 3_600_000),
        userAgent: 'perf-check',
      },
    });
    const signature = createHmac('sha256', secret).update(session.token).digest('base64');
    const cookie = `${COOKIE_NAME}=${encodeURIComponent(`${session.token}.${signature}`)}`;

    const L = `/api/v1/lists/${list.id}`;
    const routes: [string, string][] = [
      ['GET /health', '/api/v1/health'],
      ['GET /me', '/api/v1/me'],
      ['GET /lists', '/api/v1/lists'],
      ['GET /lists/:id', L],
      ['GET /lists/:id/members', `${L}/members`],
      ['GET /lists/:id/items', `${L}/items?pageSize=100`],
      ['GET /lists/:id/items?status=WANT', `${L}/items?status=WANT`],
      ['GET /lists/:id/items/random', `${L}/items/random`],
      ['GET /items/:id/ratings', `${L}/items/${firstItemId}/ratings`],
      ['GET /items/:id/comments', `${L}/items/${firstItemId}/comments`],
      ['GET /items/:id/progress', `${L}/items/${seriesItemId}/progress`],
    ];

    const get = (path: string) =>
      fetch(`${BASE_URL}${path}`, { headers: { cookie } }).then(async (res) => {
        await res.arrayBuffer();
        return res.status;
      });

    const rows: { route: string; p50: number; p95: number; max: number; bad: number }[] = [];
    for (const [route, path] of routes) {
      for (let i = 0; i < 5; i++) await get(path); // aquecimento
      const times: number[] = [];
      let bad = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const start = performance.now();
        const status = await get(path);
        times.push(performance.now() - start);
        if (status !== 200) bad++;
      }
      times.sort((a, b) => a - b);
      rows.push({
        route,
        p50: times[Math.floor(times.length / 2)] ?? 0,
        p95: p95(times),
        max: times[times.length - 1] ?? 0,
        bad,
      });
    }

    console.log(`\nAPI ${BASE_URL} · ${ITEMS} itens · 3 membros · ${SAMPLES} amostras por rota\n`);
    console.log(
      'rota'.padEnd(36),
      'p50 ms'.padStart(8),
      'p95 ms'.padStart(8),
      'max ms'.padStart(8),
      ' resultado',
    );
    let failed = false;
    for (const r of rows) {
      const ok = r.p95 < BUDGET_MS && r.bad === 0;
      if (!ok) failed = true;
      console.log(
        r.route.padEnd(36),
        r.p50.toFixed(1).padStart(8),
        r.p95.toFixed(1).padStart(8),
        r.max.toFixed(1).padStart(8),
        ok ? ' ok' : ` FALHA (${r.bad} respostas != 200)`,
      );
    }
    console.log('\nRotas de TMDB (/titles/*) ficam fora da medição, como no PRD.');
    if (failed) process.exitCode = 1;
  } finally {
    if (listId) await prisma.list.delete({ where: { id: listId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    await prisma.title.deleteMany({ where: { id: { in: titleIds } } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
