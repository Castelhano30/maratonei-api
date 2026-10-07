import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// O CLI (migrate) usa a conexão direta, sem pooler, quando existir (AD-15).
// A API em runtime usa só DATABASE_URL (src/lib/prisma.ts).
const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: url ? { url } : undefined,
});
