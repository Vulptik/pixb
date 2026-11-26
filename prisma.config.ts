import 'dotenv/config';
import { defineConfig } from 'prisma/config';

function resolveDatabaseUrl() {
  const allowMissingDatabase =
    process.env.PRISMA_ALLOW_MISSING_DB === '1' ||
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === '1' ||
    ['postinstall', 'db:generate', 'pretest', 'pretest:coverage', 'test', 'test:coverage'].includes(
      process.env.npm_lifecycle_event ?? '',
    );

  const rawUrl = process.env.DATABASE_URL;
  if (rawUrl) {
    const expanded = rawUrl.replace(/\$\{(\w+)\}/g, (_, key: string) => process.env[key] ?? '');
    if (!expanded.includes('${') && expanded.includes('://')) {
      return expanded;
    }
  }

  const host = process.env.DATABASE_HOST;
  const port = process.env.DATABASE_PORT || '5432';
  const user = process.env.POSTGRES_USER;
  const password = process.env.POSTGRES_PASSWORD;
  const dbName = process.env.POSTGRES_DB;

  if (!host || !user || !password || !dbName) {
    if (allowMissingDatabase) {
      return 'postgresql://postgres:postgres@localhost:5432/postgres?schema=public';
    }
    throw new Error('DATABASE_URL is not set and DATABASE_* vars are missing');
  }

  return `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=public`;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: resolveDatabaseUrl(),
  },
});
