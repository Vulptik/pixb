import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };
vi.mock('@/lib/server/storageStatus', () => ({ ensureStorageReady: vi.fn() }));
const maintenance = vi.hoisted(() => ({
  startMaintenanceSchedule: vi.fn(),
  stopMaintenanceSchedule: vi.fn(async () => {}),
}));
vi.mock('@/lib/server/maintenance', () => maintenance);

describe('instrumentation register', () => {
  it('validates short secrets and accepts complete fallback database fields', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.JWT_SECRET = 'short';
    process.env.ENCRYPTION_KEY = 'short';
    const { register } = await import('@/instrumentation');
    await expect(register()).rejects.toThrow('JWT_SECRET must be at least 32 characters');
    delete process.env.JWT_SECRET;
    process.env.NEXTAUTH_SECRET = 'fallback-secret-with-at-least-32-characters';
    delete process.env.ENCRYPTION_KEY;
    delete process.env.DATABASE_URL;
    for (const key of [
      'DATABASE_HOST',
      'DATABASE_PORT',
      'POSTGRES_USER',
      'POSTGRES_PASSWORD',
      'POSTGRES_DB',
    ])
      process.env[key] = 'test';
    vi.spyOn(process, 'on').mockReturnValue(process);
    await expect(register()).resolves.toBeUndefined();
  });
  it('handles both shutdown signals only once and exits after its grace period', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/pixb';
    const handlers = vi.spyOn(process, 'on').mockReturnValue(process);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    maintenance.stopMaintenanceSchedule.mockRejectedValueOnce(new Error('busy'));
    const { register } = await import('@/instrumentation');
    await register();
    const term = handlers.mock.calls.find(([signal]) => signal === 'SIGTERM')![1];
    const interrupt = handlers.mock.calls.find(([signal]) => signal === 'SIGINT')![1];
    term();
    interrupt();
    expect(maintenance.stopMaintenanceSchedule).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('skips setup outside the node runtime', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    const processOnSpy = vi.spyOn(globalThis.process, 'on');

    const { register } = await import('@/instrumentation');
    await register();

    expect(processOnSpy).not.toHaveBeenCalled();
    expect(maintenance.startMaintenanceSchedule).not.toHaveBeenCalled();
  });

  it('validates required environment values in the node runtime', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    delete process.env.JWT_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_HOST;
    delete process.env.DATABASE_PORT;
    delete process.env.POSTGRES_USER;
    delete process.env.POSTGRES_PASSWORD;
    delete process.env.POSTGRES_DB;

    const { register } = await import('@/instrumentation');

    await expect(register()).rejects.toThrow('Environment validation failed');
  });

  it('registers graceful shutdown handlers when env is valid', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/pixb';
    const processOnSpy = vi.spyOn(globalThis.process, 'on').mockReturnValue(globalThis.process);

    const { register } = await import('@/instrumentation');
    await register();

    expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(maintenance.startMaintenanceSchedule).toHaveBeenCalledOnce();

    const shutdown = processOnSpy.mock.calls.find(([signal]) => signal === 'SIGTERM')?.[1];
    shutdown?.('SIGTERM');
    expect(maintenance.stopMaintenanceSchedule).toHaveBeenCalledOnce();
  });

  it('does not start background jobs during a production build', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.NEXT_PHASE = 'phase-production-build';
    process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/pixb';
    vi.spyOn(process, 'on').mockReturnValue(process);

    const { register } = await import('@/instrumentation');
    await register();

    expect(maintenance.startMaintenanceSchedule).not.toHaveBeenCalled();
  });

  it('exits production when storage is unusable instead of retaining a failed HTTP server', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/pixb';
    Object.assign(process.env, { NODE_ENV: 'production' });
    const { ensureStorageReady } = await import('@/lib/server/storageStatus');
    vi.mocked(ensureStorageReady).mockRejectedValueOnce(new Error('File storage is unavailable.'));
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('startup aborted');
    });
    const { register } = await import('@/instrumentation');
    await expect(register()).rejects.toThrow('startup aborted');
    expect(exit).toHaveBeenCalledWith(1);
    expect(maintenance.startMaintenanceSchedule).not.toHaveBeenCalled();
  });
});
