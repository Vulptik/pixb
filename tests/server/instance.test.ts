import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  rows: new Map<string, string>(),
  db: {
    setting: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    user: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: state.db }));
import {
  getInstanceSettings,
  updateInstanceSettings,
  getSetupStatus,
  invalidateSettingsCache,
} from '@/lib/server/instance';
beforeEach(() => {
  vi.clearAllMocks();
  state.rows.clear();
  delete process.env.NEXT_PHASE;
  vi.stubEnv('PUBLIC_URL', '');
  invalidateSettingsCache();
  state.db.user.count.mockResolvedValue(0);
  state.db.setting.findMany.mockImplementation(async () =>
    [...state.rows].map(([key, value]) => ({ key, value })),
  );
  state.db.setting.findUnique.mockImplementation(async ({ where }) =>
    state.rows.has(where.key) ? { value: state.rows.get(where.key) } : null,
  );
  state.db.setting.upsert.mockImplementation(async ({ where, update }) => {
    state.rows.set(where.key, update.value);
    return update;
  });
  state.db.$transaction.mockImplementation(async (promises) => Promise.all(promises));
});
describe('essential instance settings', () => {
  it('uses the installation address, gives an override priority, and restores the default when cleared', async () => {
    vi.stubEnv('PUBLIC_URL', 'http://192.168.1.30:3010/');
    expect(await getInstanceSettings()).toMatchObject({
      publicUrl: 'http://192.168.1.30:3010',
      publicUrlOverride: '',
    });
    expect(
      await updateInstanceSettings({ publicUrl: 'https://photos.example.test' }),
    ).toMatchObject({
      publicUrl: 'https://photos.example.test',
      publicUrlOverride: 'https://photos.example.test',
    });
    expect(await updateInstanceSettings({ publicUrl: '' })).toMatchObject({
      publicUrl: 'http://192.168.1.30:3010',
      publicUrlOverride: '',
    });
  });
  it('does not copy the inherited address into the stored override when other settings are changed', async () => {
    vi.stubEnv('PUBLIC_URL', 'http://nas.local:3010');
    await updateInstanceSettings({ maxUploadSize: 5 });
    expect(state.rows.has('instance.public_url')).toBe(false);
    expect((await getInstanceSettings()).publicUrlOverride).toBe('');
  });
  it('returns safe fresh-install defaults without retired appearance/signup controls', async () => {
    const s = await getInstanceSettings();
    expect(s).toMatchObject({
      maxUploadSize: 0,
      publicUrl: '',
    });
    expect(s).not.toHaveProperty('allowSignup');
    expect(s).not.toHaveProperty('instanceName');
    expect(s).not.toHaveProperty('allowedFileTypes');
    expect(s).not.toHaveProperty('defaultQuota');
    expect(s).not.toHaveProperty('defaultLocale');
    expect(s).not.toHaveProperty('customCss');
    expect(s).not.toHaveProperty('defaultTheme');
  });
  it('avoids database queries during the production build', async () => {
    process.env.NEXT_PHASE = 'phase-production-build';
    expect((await getInstanceSettings()).publicUrl).toBe('');
    expect(state.db.setting.findMany).not.toHaveBeenCalled();
    delete process.env.NEXT_PHASE;
  });
  it('caches reads and invalidates after changes', async () => {
    await getInstanceSettings();
    await getInstanceSettings();
    expect(state.db.setting.findMany).toHaveBeenCalledTimes(1);
    await updateInstanceSettings({ maxUploadSize: 2 });
    expect((await getInstanceSettings()).maxUploadSize).toBe(2);
    expect(state.db.setting.findMany).toHaveBeenCalledTimes(2);
  });
  it('normalizes public URLs', async () => {
    await updateInstanceSettings({ publicUrl: 'example.com///' });
    expect((await getInstanceSettings()).publicUrl).toBe('https://example.com');
  });
  it('ignores a legacy instance name without deleting existing settings', async () => {
    state.rows.set('instance.name', 'Old custom name');
    const settings = await getInstanceSettings();
    expect(settings).not.toHaveProperty('instanceName');
    expect(state.rows.get('instance.name')).toBe('Old custom name');
  });
  it('ignores stored file-type restrictions and no longer updates that retired option', async () => {
    state.rows.set('instance.allowed_file_types', 'image/jpeg');
    const settings = await updateInstanceSettings({
      allowedFileTypes: 'image/png',
    } as unknown as Parameters<typeof updateInstanceSettings>[0]);
    expect(settings).not.toHaveProperty('allowedFileTypes');
    expect(state.rows.get('instance.allowed_file_types')).toBe('image/jpeg');
    expect(state.db.setting.upsert).not.toHaveBeenCalled();
  });
  it('normalizes previously stored URLs on read', async () => {
    state.rows.set('instance.public_url', 'example.com///');
    expect((await getInstanceSettings()).publicUrl).toBe('https://example.com');
  });
  it('ignores the retired default quota without changing stored settings', async () => {
    state.rows.set('instance.default_quota', '1');
    expect(await getInstanceSettings()).not.toHaveProperty('defaultQuota');
    expect(state.rows.get('instance.default_quota')).toBe('1');
  });
  it('ignores and does not update the retired instance language', async () => {
    state.rows.set('instance.default_locale', 'fr');
    const input = { defaultLocale: 'en' } as unknown as Parameters<
      typeof updateInstanceSettings
    >[0];
    expect(await updateInstanceSettings(input)).not.toHaveProperty('defaultLocale');
    expect(state.rows.get('instance.default_locale')).toBe('fr');
    expect(state.db.setting.upsert).not.toHaveBeenCalled();
  });
  it.each([{ maxUploadSize: -1 }, { maxUploadSize: NaN }])(
    'rejects malformed essential settings',
    async (input) => {
      await expect(updateInstanceSettings(input)).rejects.toThrow();
      expect(state.db.setting.upsert).not.toHaveBeenCalled();
    },
  );
  it.each([
    'https://user:password@example.com',
    'https://example.com/?token=private',
    'https://example.com/#secret',
    'javascript:alert(1)',
    'https://example.com/pixb',
  ])('rejects unsafe public URL %s', async (publicUrl) => {
    await expect(updateInstanceSettings({ publicUrl })).rejects.toThrow();
  });
  it('requires setup only on a genuinely fresh database', async () => {
    expect((await getSetupStatus()).required).toBe(true);
    state.db.user.count.mockResolvedValue(1);
    expect((await getSetupStatus()).required).toBe(false);
  });
  it('does not reopen setup after it has completed', async () => {
    state.rows.set('instance.setup_completed', 'true');
    expect((await getSetupStatus()).required).toBe(false);
  });
  it('persists the optional upload limit', async () => {
    const s = await updateInstanceSettings({
      maxUploadSize: 25,
    });
    expect(s).toMatchObject({
      maxUploadSize: 25,
    });
  });
});
