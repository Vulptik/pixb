import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool, PoolConfig } from 'pg';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaPool?: Pool;
};

function resolveDatabaseUrl(): string {
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
    throw new Error('DATABASE_URL is not set and DATABASE_* vars are missing');
  }

  return `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=public`;
}

export function getDatabasePool(): Pool {
  globalForPrisma.prismaPool ??= new Pool({
    connectionString: resolveDatabaseUrl(),
    max: 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 2_000,
  } as PoolConfig);
  return globalForPrisma.prismaPool;
}

function initPrisma(): PrismaClient {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }

  const adapter = new PrismaPg(getDatabasePool());
  const client = new PrismaClient({ adapter });

  // Always cache in the global scope to avoid creating excessive connections.
  globalForPrisma.prisma = client;

  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = initPrisma();
    const value = Reflect.get(client, prop);
    return typeof value === 'function' ? value.bind(client) : value;
  },
}) as PrismaClient;
