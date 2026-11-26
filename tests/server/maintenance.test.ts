import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: new Map<string, string>(),
  client: { query: vi.fn(), on: vi.fn(), removeListener: vi.fn(), release: vi.fn() },
  connect: vi.fn(),
  db: {
    session: { deleteMany: vi.fn() },
    authChallenge: { deleteMany: vi.fn() },
    passwordReset: { deleteMany: vi.fn() },
    user: { findMany: vi.fn() },
    setting: { findMany: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  },
  staleUploads: vi.fn(),
  rebuild: vi.fn(),
  scan: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: state.db,
  getDatabasePool: () => ({ connect: state.connect }),
}));
vi.mock('@/lib/server/logger', () => ({ logger: { info: state.info, error: state.error } }));
vi.mock('@/lib/server/tusStorage', () => ({ cleanupStaleTusUploads: state.staleUploads }));
vi.mock('@/lib/server/medias/cache', () => ({ rebuildUserCache: state.rebuild }));
vi.mock('@/lib/server/orphanFiles', () => ({ scanOrphanFiles: state.scan }));

const now = new Date('2026-11-03T12:00:00Z');
const keys = ['cleanup', 'usage', 'orphans'].map((job) => `maintenance.${job}.last_success`);

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  delete (globalThis as typeof globalThis & { pixbMaintenance?: unknown }).pixbMaintenance;
  vi.stubEnv('NEXT_PHASE', '');
  state.rows.clear();
  state.connect.mockResolvedValue(state.client);
  state.client.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('pg_try_advisory_lock')
      ? [{ locked: true }]
      : sql.includes('pg_advisory_unlock')
        ? [{ unlocked: true }]
        : [],
  }));
  for (const table of [state.db.session, state.db.authChallenge, state.db.passwordReset])
    table.deleteMany.mockResolvedValue({ count: 2 });
  state.db.$transaction.mockImplementation(async (operations) => Promise.all(operations));
  state.db.setting.findMany.mockImplementation(async () =>
    [...state.rows].map(([key, value]) => ({ key, value })),
  );
  state.db.setting.upsert.mockImplementation(async ({ where, update }) => {
    state.rows.set(where.key, update.value);
    return update;
  });
  state.db.user.findMany.mockResolvedValue([]);
  state.staleUploads.mockResolvedValue(3);
  state.rebuild.mockResolvedValue(undefined);
  state.scan.mockResolvedValue({
    items: [{ relativePath: 'private-file-name' }],
    totalSize: 42,
    scannedFiles: 7,
    truncated: false,
  });
});

afterEach(async () => {
  const { stopMaintenanceSchedule } = await import('@/lib/server/maintenance');
  await stopMaintenanceSchedule();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('automatic maintenance', () => {
  it('cleans expired records, rebuilds usage in batches, reports orphans, and saves success', async () => {
    const { runMaintenance } = await import('@/lib/server/maintenance');
    state.db.user.findMany
      .mockResolvedValueOnce([{ id: 1n }, { id: 2n }])
      .mockResolvedValueOnce([{ id: 3n }])
      .mockResolvedValueOnce([]);
    expect(await runMaintenance()).toEqual({
      status: 'completed',
      completed: ['cleanup', 'usage', 'orphans'],
      failed: [],
    });
    for (const table of [state.db.session, state.db.authChallenge, state.db.passwordReset])
      expect(table.deleteMany).toHaveBeenCalledWith({ where: { expires_at: { lt: now } } });
    expect(state.staleUploads).toHaveBeenCalledOnce();
    expect(state.rebuild.mock.calls).toEqual([[1n], [2n], [3n]]);
    expect(state.db.user.findMany).toHaveBeenNthCalledWith(2, {
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 100,
      where: { id: { gt: 2n } },
    });
    expect(state.rows.size).toBe(3);
    expect(state.rows.get(keys[0])).toBe(now.toISOString());
    expect(state.info).toHaveBeenCalledWith(
      { files: 1, bytes: 42, scannedFiles: 7, truncated: false },
      expect.any(String),
    );
    expect(JSON.stringify(state.info.mock.calls)).not.toContain('private-file-name');
    expect(state.client.query).toHaveBeenLastCalledWith(
      'SELECT pg_advisory_unlock($1, $2) AS unlocked',
      expect.any(Array),
    );
    expect(state.client.release).toHaveBeenCalledWith(undefined);
  });

  it('persists cadence across reloads, reruns hourly cleanup, and permits an explicit force', async () => {
    const first = await import('@/lib/server/maintenance');
    await first.runMaintenance();
    vi.resetModules();
    const { runMaintenance } = await import('@/lib/server/maintenance');
    expect((await runMaintenance()).completed).toEqual([]);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect((await runMaintenance()).completed).toEqual(['cleanup']);
    expect((await runMaintenance({ force: true })).completed).toEqual([
      'cleanup',
      'usage',
      'orphans',
    ]);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect((await runMaintenance()).completed).toEqual(['cleanup', 'usage', 'orphans']);
  });

  it('does not mark a failed job successful and retries without blocking independent jobs', async () => {
    const { runMaintenance } = await import('@/lib/server/maintenance');
    state.staleUploads.mockRejectedValueOnce(new Error('storage unavailable'));
    expect(await runMaintenance()).toEqual({
      status: 'completed',
      completed: ['usage', 'orphans'],
      failed: ['cleanup'],
    });
    expect(state.rows.has(keys[0])).toBe(false);
    expect(state.error).toHaveBeenCalledWith(
      expect.objectContaining({ job: 'cleanup' }),
      expect.any(String),
    );
    expect((await runMaintenance()).completed).toEqual(['cleanup']);
  });

  it('skips when another process owns the lock', async () => {
    const { runMaintenance } = await import('@/lib/server/maintenance');
    state.client.query.mockResolvedValueOnce({ rows: [{ locked: false }] });
    expect((await runMaintenance()).status).toBe('busy');
    expect(state.db.setting.findMany).not.toHaveBeenCalled();
    expect(state.client.query).toHaveBeenCalledTimes(1);
    expect(state.client.release).toHaveBeenCalledWith(undefined);
  });

  it('defers cleanup during active uploads without logging an error or delaying its next retry', async () => {
    const { runMaintenance } = await import('@/lib/server/maintenance');
    state.staleUploads.mockResolvedValueOnce(null);

    expect(await runMaintenance()).toEqual({
      status: 'completed',
      completed: ['usage', 'orphans'],
      failed: ['cleanup'],
    });
    expect(state.rows.has(keys[0])).toBe(false);
    expect(state.error).not.toHaveBeenCalled();
    expect(state.info).toHaveBeenCalledWith(expect.stringContaining('deferred'));

    vi.advanceTimersByTime(60_000);
    expect((await runMaintenance()).completed).toEqual(['cleanup']);
    expect(state.rows.get(keys[0])).toBe(new Date().toISOString());
  });

  it('does not save orphan-scan success after an unreadable directory and retries the scan', async () => {
    const { runMaintenance } = await import('@/lib/server/maintenance');
    state.scan.mockRejectedValueOnce(
      Object.assign(new Error('Storage read failed'), { code: 'EIO' }),
    );

    expect(await runMaintenance()).toEqual({
      status: 'completed',
      completed: ['cleanup', 'usage'],
      failed: ['orphans'],
    });
    expect(state.rows.has(keys[2])).toBe(false);
    expect((await runMaintenance()).completed).toEqual(['orphans']);
    expect(state.scan).toHaveBeenCalledTimes(2);
    expect(state.rows.get(keys[2])).toBe(now.toISOString());
  });

  it('prevents overlapping manual and scheduled runs in the same process', async () => {
    const { runMaintenance } = await import('@/lib/server/maintenance');
    let finishConnect!: (value: typeof state.client) => void;
    state.connect.mockReturnValueOnce(
      new Promise((resolve) => {
        finishConnect = resolve;
      }),
    );
    const pending = runMaintenance();
    expect((await runMaintenance({ force: true })).status).toBe('busy');
    finishConnect(state.client);
    await pending;
    expect(state.connect).toHaveBeenCalledOnce();
  });

  it('destroys a connection when lock acquisition fails ambiguously', async () => {
    const { runMaintenance } = await import('@/lib/server/maintenance');
    const failure = new Error('connection lost');
    state.client.query.mockRejectedValueOnce(failure);
    await expect(runMaintenance()).rejects.toThrow('connection lost');
    expect(state.client.release).toHaveBeenCalledWith(failure);
  });

  it('destroys a connection rather than returning an unreleased lock to the pool', async () => {
    const { runMaintenance } = await import('@/lib/server/maintenance');
    state.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_advisory_unlock')) throw new Error('unlock failed');
      return { rows: [{ locked: true }] };
    });
    await runMaintenance();
    expect(state.client.release).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'unlock failed' }),
    );
  });

  it('tolerates a user deleted between batching and reconciliation', async () => {
    const { runMaintenance } = await import('@/lib/server/maintenance');
    state.db.user.findMany.mockResolvedValueOnce([{ id: 1n }]).mockResolvedValueOnce([]);
    state.rebuild.mockRejectedValueOnce(
      Object.assign(new Error('missing user'), { code: 'P2025' }),
    );
    expect((await runMaintenance()).failed).toEqual([]);
  });

  it('starts immediately, avoids duplicate timers across reloads, retries on ticks, and stops', async () => {
    const first = await import('@/lib/server/maintenance');
    first.startMaintenanceSchedule();
    vi.resetModules();
    const second = await import('@/lib/server/maintenance');
    second.startMaintenanceSchedule();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.connect).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.connect).toHaveBeenCalledTimes(2);
    await second.stopMaintenanceSchedule();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.connect).toHaveBeenCalledTimes(2);
  });

  it('does not schedule or run while generating the production build', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    const { startMaintenanceSchedule, runMaintenance } = await import('@/lib/server/maintenance');
    startMaintenanceSchedule();
    expect((await runMaintenance()).status).toBe('disabled');
    expect(vi.getTimerCount()).toBe(0);
    expect(state.connect).not.toHaveBeenCalled();
  });
});
