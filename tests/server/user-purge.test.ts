import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  user: vi.fn(),
  files: vi.fn(),
  remove: vi.fn(),
  rm: vi.fn(),
  warn: vi.fn(),
  transaction: vi.fn(),
  mediaDelete: vi.fn(),
  collectionDelete: vi.fn(),
  keyDelete: vi.fn(),
  sessionDelete: vi.fn(),
}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findUnique: state.user },
    media: { findMany: state.files, deleteMany: state.mediaDelete },
    collection: { deleteMany: state.collectionDelete },
    apiKey: { deleteMany: state.keyDelete },
    session: { deleteMany: state.sessionDelete },
    $transaction: state.transaction,
  },
}));
vi.mock('@/lib/server/medias/storage', () => ({ deleteMediaFiles: state.remove }));
vi.mock('@/lib/server/storagePaths', () => ({ getMediaStorageDir: async () => '/storage' }));
vi.mock('@/lib/server/logger', () => ({ logger: { warn: state.warn } }));
vi.mock('fs/promises', () => ({ rm: state.rm }));
import { deleteUserData } from '@/lib/server/users/purge';
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('PIXB_LOCAL_DEV', '');
  state.files.mockResolvedValue([]);
  state.remove.mockResolvedValue(undefined);
  state.rm.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
it('protects the persistent local admin before touching any user data', async () => {
  vi.stubEnv('PIXB_LOCAL_DEV', '1');
  state.user.mockResolvedValue({ email: 'admin@pixb.local' });
  await expect(deleteUserData(1n)).rejects.toThrow('persistent development admin');
  expect(state.files).not.toHaveBeenCalled();
  expect(state.transaction).not.toHaveBeenCalled();
  expect(state.rm).not.toHaveBeenCalled();
});
it.each([null, { email: 'other@example.test' }])(
  'allows cleanup of other local accounts (%j)',
  async (user) => {
    vi.stubEnv('PIXB_LOCAL_DEV', '1');
    state.user.mockResolvedValue(user);
    await deleteUserData(7n);
    expect(state.transaction).toHaveBeenCalledOnce();
    expect(state.rm).toHaveBeenCalledWith(path.join('/storage', '7'), {
      recursive: true,
      force: true,
    });
  },
);
it('continues after individual file failures, batches deletes and cleans every related record', async () => {
  state.files.mockResolvedValue(
    Array.from({ length: 51 }, (_, id) => ({ file_data: `file-${id}` })),
  );
  const error = new Error('permission denied');
  state.remove.mockRejectedValueOnce(error);
  state.rm.mockRejectedValueOnce(error);
  await deleteUserData(7n);
  expect(state.remove).toHaveBeenCalledTimes(51);
  expect(state.remove).toHaveBeenLastCalledWith('file-50');
  for (const remove of [
    state.mediaDelete,
    state.collectionDelete,
    state.keyDelete,
    state.sessionDelete,
  ]) {
    expect(remove).toHaveBeenCalledWith({ where: { user_id: 7n } });
  }
  expect(state.warn).toHaveBeenCalledWith(
    { err: error, file: 'file-0' },
    'Failed to delete media files',
  );
  expect(state.warn).toHaveBeenCalledWith(
    { err: error, dir: path.join('/storage', '7') },
    'Failed to delete user storage directory',
  );
});
