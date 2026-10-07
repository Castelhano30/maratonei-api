import { afterAll, beforeEach } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { resetDb } from './helpers/reset-db.js';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});
