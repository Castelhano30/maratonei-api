import { afterAll, beforeEach } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { resetOutbox } from './helpers/outbox.js';
import { resetDb } from './helpers/reset-db.js';

beforeEach(async () => {
  resetOutbox();
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});
