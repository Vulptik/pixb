import { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaClientMock = vi.hoisted(() =>
  vi.fn(function (this: { adapter?: unknown }) {
    this.adapter = undefined;
  }),
);

const prismaPgMock = vi.hoisted(() =>
  vi.fn(function (this: { pool?: unknown }, pool: unknown) {
    this.pool = pool;
  }),
);

const poolMock = vi.hoisted(() => vi.fn());
const cache = globalThis as typeof globalThis & { prisma?: unknown; prismaPool?: unknown };

vi.mock('@prisma/client', () => ({
  PrismaClient: prismaClientMock,
}));

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: prismaPgMock,
}));

vi.mock('pg', () => ({
  Pool: poolMock,
}));

describe('prisma client singleton', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete cache.prisma;
    delete cache.prismaPool;
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
  });
  afterEach(() => {
    delete cache.prisma;
    delete cache.prismaPool;
    vi.unstubAllEnvs();
  });

  it('reuses the pool and binds proxied methods to the same client', async () => {
    const method = vi.fn(function (this: { marker: string }) {
      return this.marker;
    });
    const client = { marker: 'client', method };
    cache.prisma = client;
    const { prisma, getDatabasePool } = await import('@/lib/db/prisma');
    const proxied = prisma as unknown as typeof client;
    expect(proxied.marker).toBe('client');
    expect(proxied.method()).toBe('client');
    expect(getDatabasePool()).toBe(getDatabasePool());
    expect(poolMock).toHaveBeenCalledOnce();
    expect(prismaClientMock).not.toHaveBeenCalled();
  });
  it('expands database URL variables without creating a pool more than once', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://${DB_TEST_USER}:${DB_TEST_MISSING}@localhost/db');
    vi.stubEnv('DB_TEST_USER', 'alice');
    vi.stubEnv('DB_TEST_MISSING', undefined);
    const { getDatabasePool } = await import('@/lib/db/prisma');
    getDatabasePool();
    getDatabasePool();
    expect(poolMock).toHaveBeenCalledOnce();
    expect(poolMock).toHaveBeenCalledWith(
      expect.objectContaining({ connectionString: 'postgresql://alice:@localhost/db' }),
    );
  });
  it.each(['', 'invalid', '${bad-variable}'])(
    'falls back to database fields when URL is %j',
    async (url) => {
      vi.stubEnv('DATABASE_URL', url);
      vi.stubEnv('DATABASE_HOST', 'db.local');
      vi.stubEnv('DATABASE_PORT', '');
      vi.stubEnv('POSTGRES_USER', 'pixb');
      vi.stubEnv('POSTGRES_PASSWORD', 'test');
      vi.stubEnv('POSTGRES_DB', 'library');
      const { getDatabasePool } = await import('@/lib/db/prisma');
      getDatabasePool();
      expect(poolMock).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionString: 'postgresql://pixb:test@db.local:5432/library?schema=public',
        }),
      );
    },
  );
  it.each(['DATABASE_HOST', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'])(
    'rejects an incomplete fallback configuration missing %s',
    async (missing) => {
      vi.stubEnv('DATABASE_URL', '');
      for (const key of ['DATABASE_HOST', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'])
        vi.stubEnv(key, 'test');
      vi.stubEnv(missing, '');
      const { getDatabasePool } = await import('@/lib/db/prisma');
      expect(() => getDatabasePool()).toThrow('DATABASE_URL is not set');
      expect(poolMock).not.toHaveBeenCalled();
    },
  );

  it('creates prisma client with adapter', async () => {
    const { prisma } = await import('@/lib/db/prisma');
    expect(prisma).toBeDefined();
    // Access a property to trigger lazy initialization via proxy.
    void (prisma as PrismaClient).$on;
    expect(prismaClientMock).toHaveBeenCalled();
    expect(prismaPgMock).toHaveBeenCalled();
  });
});
