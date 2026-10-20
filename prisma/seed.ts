/**
 * Seed idempotente para dev e E2E: cria (ou atualiza) o usuário verificado usado
 * pelo E2E do web, com uma conta `credential` cuja senha é um hash argon2id.
 * Recusa rodar com NODE_ENV=production e contra banco que não seja local, a menos que
 * `SEED_ALLOW_REMOTE=1` (opt-in explícito).
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client.js';

const SEED_E2E_EMAIL = 'e2e@maratonei.local';
const SEED_E2E_NAME = 'Usuário E2E';
const SEED_LIST_NAME = 'Maratona de exemplo';
const SEED_LIST_DESCRIPTION = 'Lista de exemplo criada pelo seed de desenvolvimento.';
const SEED_RATING_STARS = 4;
const SEED_PROGRESS_EPISODES = [
  { season: 1, episode: 1 },
  { season: 1, episode: 2 },
];
const SEED_COMMENT = 'Ótimo para a próxima maratona!';
const DEFAULT_SEED_E2E_PASSWORD = 'maratonei-e2e-123';

// Títulos de exemplo (dados estáticos: o seed nunca chama o TMDB).
interface SeedTitle {
  tmdbId: number;
  mediaType: 'MOVIE' | 'TV';
  name: string;
  overview: string;
  posterPath: string;
  releaseYear: number;
  genreIds: number[];
  genres: string[];
  runtime: number | null;
  seasons?: { season: number; episodeCount: number }[];
  status: 'WANT' | 'WATCHING' | 'WATCHED';
}

const SEED_TITLES: SeedTitle[] = [
  {
    tmdbId: 438631,
    mediaType: 'MOVIE',
    name: 'Duna',
    overview: 'Paul Atreides une forças com os Fremen para vingar sua família.',
    posterPath: '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg',
    releaseYear: 2021,
    genreIds: [878, 12],
    genres: ['Ficção científica', 'Aventura'],
    runtime: 155,
    status: 'WANT',
  },
  {
    tmdbId: 70523,
    mediaType: 'TV',
    name: 'Dark',
    overview: 'Uma cidade alemã esconde segredos que atravessam gerações.',
    posterPath: '/apbrbWs8M9lyOpJYU5WXrpFbk1Z.jpg',
    releaseYear: 2017,
    genreIds: [9648, 18],
    genres: ['Mistério', 'Drama'],
    runtime: null,
    seasons: [
      { season: 1, episodeCount: 10 },
      { season: 2, episodeCount: 8 },
      { season: 3, episodeCount: 8 },
    ],
    status: 'WATCHING',
  },
];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function databaseHost(connectionString: string): string {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL inválida.');
  }
  // `?host=`/`?hostaddr=` trocam o host real da conexão: não há como confiar no hostname.
  if (url.searchParams.has('host') || url.searchParams.has('hostaddr')) {
    throw new Error('O seed recusa DATABASE_URL com "host" ou "hostaddr" na query.');
  }
  return url.hostname.toLowerCase();
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('O seed não roda com NODE_ENV=production.');
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL não definida.');
  }

  const host = databaseHost(connectionString);
  if (!LOCAL_HOSTS.has(host) && process.env.SEED_ALLOW_REMOTE !== '1') {
    throw new Error(
      `O seed recusa o banco "${host}" (não é local). Para forçar, defina SEED_ALLOW_REMOTE=1.`,
    );
  }

  const password = process.env.SEED_E2E_PASSWORD || DEFAULT_SEED_E2E_PASSWORD;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { email: SEED_E2E_EMAIL },
        create: { email: SEED_E2E_EMAIL, name: SEED_E2E_NAME, emailVerified: true },
        update: { name: SEED_E2E_NAME, emailVerified: true },
      });

      // Lista de exemplo do usuário E2E (idempotente: uma só, identificada por dono e nome).
      const existingList = await tx.list.findFirst({
        where: { ownerId: user.id, name: SEED_LIST_NAME },
        select: { id: true },
      });
      const list =
        existingList ??
        (await tx.list.create({
          data: {
            name: SEED_LIST_NAME,
            description: SEED_LIST_DESCRIPTION,
            ownerId: user.id,
            members: { create: { userId: user.id, role: 'OWNER' } },
          },
          select: { id: true },
        }));

      // Itens de exemplo (idempotente: título global por (mediaType, tmdbId), item por (lista, título)).
      for (const { status, seasons, ...title } of SEED_TITLES) {
        const row = await tx.title.upsert({
          where: { mediaType_tmdbId: { mediaType: title.mediaType, tmdbId: title.tmdbId } },
          create: { ...title, ...(seasons ? { seasons } : {}) },
          update: {},
          select: { id: true },
        });
        const item = await tx.listItem.upsert({
          where: { listId_titleId: { listId: list.id, titleId: row.id } },
          create: { listId: list.id, titleId: row.id, addedById: user.id, status },
          update: {},
          select: { id: true },
        });
        // Nota e comentário de exemplo só no primeiro título (idempotente).
        if (title.tmdbId === SEED_TITLES[0]?.tmdbId) {
          const member = await tx.listMember.findUniqueOrThrow({
            where: { listId_userId: { listId: list.id, userId: user.id } },
            select: { id: true },
          });
          await tx.rating.upsert({
            where: { listItemId_memberId: { listItemId: item.id, memberId: member.id } },
            create: { listItemId: item.id, memberId: member.id, stars: SEED_RATING_STARS },
            update: {},
          });
          const hasComment = await tx.comment.findFirst({
            where: { listItemId: item.id, memberId: member.id, body: SEED_COMMENT },
            select: { id: true },
          });
          if (!hasComment) {
            await tx.comment.create({
              data: { listItemId: item.id, memberId: member.id, body: SEED_COMMENT },
            });
          }
        }
      }

      // Progresso de exemplo na série (idempotente).
      const series = SEED_TITLES.find((t) => t.mediaType === 'TV');
      if (series) {
        const seriesRow = await tx.title.findUniqueOrThrow({
          where: { mediaType_tmdbId: { mediaType: 'TV', tmdbId: series.tmdbId } },
          select: { id: true },
        });
        const seriesItem = await tx.listItem.findUniqueOrThrow({
          where: { listId_titleId: { listId: list.id, titleId: seriesRow.id } },
          select: { id: true },
        });
        const member = await tx.listMember.findUniqueOrThrow({
          where: { listId_userId: { listId: list.id, userId: user.id } },
          select: { id: true },
        });
        for (const { season, episode } of SEED_PROGRESS_EPISODES) {
          await tx.episodeProgress.upsert({
            where: {
              listItemId_memberId_season_episode: {
                listItemId: seriesItem.id,
                memberId: member.id,
                season,
                episode,
              },
            },
            create: { listItemId: seriesItem.id, memberId: member.id, season, episode },
            update: {},
          });
        }
      }

      const credential = await tx.account.findFirst({
        where: { userId: user.id, providerId: 'credential' },
      });
      if (credential) {
        await tx.account.update({
          where: { id: credential.id },
          data: { accountId: user.id, password: passwordHash },
        });
      } else {
        await tx.account.create({
          data: {
            userId: user.id,
            providerId: 'credential',
            accountId: user.id,
            password: passwordHash,
          },
        });
      }
    });

    console.log(
      `Seed concluído: usuário ${SEED_E2E_EMAIL} verificado, com uma lista de exemplo, dois itens, uma nota, um comentário e dois episódios assistidos.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
