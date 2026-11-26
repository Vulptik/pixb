import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  statfs: vi.fn(),
  stat: vi.fn(),
  mkdir: vi.fn(),
  open: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
  rm: vi.fn(),
  write: vi.fn(),
  sync: vi.fn(),
  close: vi.fn(),
}));
vi.mock('fs/promises', () => ({ default: { ...state, readFile: vi.fn() } }));
vi.mock('@/lib/server/storagePaths', () => ({
  getMediaStorageDir: async () => '/safe/uploads',
  getTusStorageDir: async () => '/safe/tus',
}));
import {
  assertStorageCapacity,
  assertStorageMove,
  ensureStorageReady,
  storageFailure,
  STORAGE_RESERVE_BYTES,
} from '@/lib/server/storageStatus';
beforeEach(() => {
  vi.resetAllMocks();
  for (const operation of [
    state.mkdir,
    state.rename,
    state.unlink,
    state.rm,
    state.write,
    state.sync,
    state.close,
  ])
    operation.mockResolvedValue(undefined);
  state.statfs.mockResolvedValue({ bavail: STORAGE_RESERVE_BYTES + 10n, bsize: 1n });
  state.open.mockResolvedValue({ writeFile: state.write, sync: state.sync, close: state.close });
});
it('respects the exact safety-reserve boundary and requested bytes', async () => {
  await expect(assertStorageCapacity('/safe/uploads', 10)).resolves.toBeUndefined();
  await expect(assertStorageCapacity('/safe/uploads', 11)).rejects.toMatchObject({
    status: 507,
    code: 'storageFull',
  });
});
it('fails closed when available space cannot be determined', async () => {
  state.statfs.mockRejectedValue(
    Object.assign(new Error('private mount details'), { code: 'EIO' }),
  );
  await expect(assertStorageCapacity('/safe/uploads', 1)).rejects.toMatchObject({
    status: 503,
    code: 'storageUnavailable',
  });
});
it('budgets a second copy only when moving between filesystems', async () => {
  state.stat.mockResolvedValueOnce({ dev: 1 }).mockResolvedValueOnce({ dev: 1 });
  await assertStorageMove('/staging/file', '/safe/uploads', 1000);
  state.stat.mockResolvedValueOnce({ dev: 1 }).mockResolvedValueOnce({ dev: 2 });
  await expect(assertStorageMove('/staging/file', '/safe/uploads', 1000)).rejects.toMatchObject({
    code: 'storageFull',
  });
});
it('probes create, write, sync, rename and delete in both storage directories', async () => {
  await ensureStorageReady();
  expect(state.open).toHaveBeenCalledTimes(2);
  expect(state.write).toHaveBeenCalledTimes(2);
  expect(state.sync).toHaveBeenCalledTimes(2);
  expect(state.rename).toHaveBeenCalledTimes(2);
  expect(state.unlink).toHaveBeenCalledTimes(2);
  expect(
    state.rm.mock.calls.every(([file]) =>
      /\/safe\/(uploads|tus)\/\.pixb-storage-probe-/.test(file.replaceAll('\\', '/')),
    ),
  ).toBe(true);
});
it.each(['EACCES', 'EROFS', 'ENOSPC'])(
  'rejects a %s storage probe and cleans only its probe files',
  async (code) => {
    state.write.mockRejectedValueOnce(Object.assign(new Error('denied'), { code }));
    await expect(ensureStorageReady()).rejects.toMatchObject({
      code: code === 'ENOSPC' ? 'storageFull' : 'storageUnavailable',
    });
    expect(state.close).toHaveBeenCalled();
    expect(state.rename).not.toHaveBeenCalled();
    expect(state.rm).toHaveBeenCalledTimes(2);
  },
);
it('maps filesystem and dataset-quota failures without exposing filesystem paths', () => {
  const failure = storageFailure(
    new Error('wrapped', { cause: { code: 'EDQUOT', path: '/private/dataset' } }),
  );
  expect(failure).toMatchObject({ status: 507, code: 'storageFull' });
  expect(failure?.message).not.toContain('/private');
});
