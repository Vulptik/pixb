import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  databaseUrl,
  assertMigrationState,
  armRecovery,
  checkRecovery,
} = require('../../docker/db-check.js');

function database(hasHistory: boolean, hasTables: boolean, history: object[] = []) {
  return {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ has_history: hasHistory, has_tables: hasTables }] })
      .mockResolvedValueOnce({ rows: history }),
  };
}

describe('container database preflight', () => {
  it('allows a fresh database without changing it', async () => {
    const client = database(false, false);
    await assertMigrationState(client, ['init']);
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('refuses an untracked schema, including one without a users table', async () => {
    const client = database(false, true);
    await expect(assertMigrationState(client, ['init'])).rejects.toThrow('no Prisma history');
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it.each(['init', 'upgrade'])(
    'refuses an interrupted %s migration without resetting it',
    async (migration) => {
      const client = database(true, true, [
        { migration_name: migration, finished_at: null, rolled_back_at: null },
      ]);
      await expect(assertMigrationState(client, ['init', 'upgrade'])).rejects.toThrow(
        'failed or was interrupted',
      );
      expect(client.query.mock.calls.every(([sql]) => sql.trim().startsWith('SELECT'))).toBe(true);
    },
  );

  it('refuses existing tables with an empty migration history', async () => {
    await expect(assertMigrationState(database(true, true), ['init'])).rejects.toThrow(
      'no successfully applied',
    );
  });

  it('refuses a database from a different/newer image', async () => {
    await expect(
      assertMigrationState(
        database(true, true, [
          { migration_name: 'future', finished_at: new Date(), rolled_back_at: null },
        ]),
        ['init'],
      ),
    ).rejects.toThrow('newer than or different');
  });

  it('allows known applied migrations and rolled-back attempts for Prisma to inspect', async () => {
    await assertMigrationState(
      database(true, true, [
        { migration_name: 'init', finished_at: new Date(), rolled_back_at: null },
        { migration_name: 'upgrade', finished_at: null, rolled_back_at: new Date() },
      ]),
      ['init', 'upgrade'],
    );
  });

  it('refuses an edited initial schema without changing the database', async () => {
    const client = database(true, true, [
      { migration_name: 'init', checksum: 'old', finished_at: new Date(), rolled_back_at: null },
    ]);
    await expect(
      assertMigrationState(client, ['init'], new Map([['init', 'new']])),
    ).rejects.toThrow('initial schema differs');
    expect(client.query.mock.calls.every(([sql]) => sql.trim().startsWith('SELECT'))).toBe(true);
  });
});

describe('container database configuration', () => {
  it('encodes reserved characters in component credentials', () => {
    const value = databaseUrl({
      DATABASE_HOST: 'db',
      POSTGRES_USER: 'pixb@user',
      POSTGRES_PASSWORD: 'p@ss:/?#%',
      POSTGRES_DB: 'pixb name',
    });
    const parsed = new URL(value);
    expect(decodeURIComponent(parsed.username)).toBe('pixb@user');
    expect(decodeURIComponent(parsed.password)).toBe('p@ss:/?#%');
    expect(decodeURIComponent(parsed.pathname)).toBe('/pixb name');
    expect(parsed.hostname).toBe('db');
  });

  it('requires database configuration', () => {
    expect(() => databaseUrl({})).toThrow('Set DATABASE_URL');
  });

  it('refuses schemas that are outside the public preflight', () => {
    expect(() => databaseUrl({ DATABASE_URL: 'postgresql://u:p@db/app?schema=other' })).toThrow(
      'public database schema',
    );
  });
});

describe('explicit operator recovery', () => {
  it('requires arming instead of treating a missing flag as permission', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(checkRecovery(client)).rejects.toThrow('not armed');
  });

  it('keeps consumed recovery disabled on restart without writing a flag', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ value: 'true' }] }) };
    expect(await checkRecovery(client)).toBe(false);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0][0]).toMatch(/^SELECT/);
  });

  it('only arms recovery if an administrator exists', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(armRecovery(client)).rejects.toThrow('No administrator');
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('explicitly arms a fresh or previously consumed recovery session', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 1 }] }) };
    await armRecovery(client);
    expect(client.query.mock.calls[1][0]).toContain('updated_at');
    expect(client.query.mock.calls[1][0]).toContain('ON CONFLICT');
  });
});
