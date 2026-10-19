import { afterAll, beforeEach } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { resetOutbox } from './helpers/outbox.js';
import { resetDb } from './helpers/reset-db.js';
import { resetTmdb } from './helpers/tmdb.js';

beforeEach(async () => {
  resetOutbox();
  resetTmdb();
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});
