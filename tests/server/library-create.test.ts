import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  settings: vi.fn(),
  stat: vi.fn(),
  store: vi.fn(),
  remove: vi.fn(),
  preview: vi.fn(),
  queue: vi.fn(),
  finalize: vi.fn(),
  findCollection: vi.fn(),
  create: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({ stat: state.stat }));
vi.mock('@/lib/server/instance', () => ({ getInstanceSettings: state.settings }));
vi.mock('@/lib/server/storageStatus', () => ({
  assertStorageMove: vi.fn(),
}));
vi.mock('@/lib/server/medias/storage', () => ({
  storeMediaFileFromPath: state.store,
  deleteMediaFiles: state.remove,
  generateMediaPreview: state.preview,
  MagicByteError: class extends Error {},
}));
vi.mock('@/lib/server/medias/quota', () => ({ finalizeWithUserQuota: state.finalize }));
vi.mock('@/lib/server/medias/uid', () => ({ generateUniqueMediaUid: async () => 'new-uid' }));
vi.mock('@/lib/server/medias/previews', () => ({ enqueuePreviewJob: state.queue }));
import { createMediaFromPath } from '@/lib/server/medias/create';
import { MagicByteError } from '@/lib/server/medias/storage';
const owner = { id: 1n, quota: 1, cached_quota_used: 0n };
beforeEach(() => {
  vi.clearAllMocks();
  state.remove.mockResolvedValue(undefined);
  state.settings.mockResolvedValue({ maxUploadSize: 5, allowedFileTypes: '' });
  state.stat.mockResolvedValue({ size: 100 });
  const stored = {
    path: '/safe/stored.png',
    filename: 'test.png',
    mimeType: 'image/png',
    size: 100,
  };
  state.store.mockResolvedValue(stored);
  state.findCollection.mockResolvedValue({ id: 3n });
  state.create.mockImplementation(async ({ data }) => ({ id: 2n, ...data }));
  state.finalize.mockImplementation(async (_owner, _size, create) => ({
    ok: true,
    data: await create({
      collection: { findFirst: state.findCollection },
      media: { create: state.create },
    }),
  }));
});
describe('validated upload finalization', () => {
  it('creates private media independent of legacy user preferences', async () => {
    const result = await createMediaFromPath(owner, '/tmp/upload', 'test.png', 'image/png');
    expect(result).toHaveProperty('data.is_shared', false);
    expect(state.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: 1n,
          uid: 'new-uid',
          is_shared: false,
          file_data: '/safe/stored.png',
        }),
      }),
    );
  });
  it('uses actual staged file size for quota enforcement', async () => {
    await createMediaFromPath(owner, '/tmp/upload', 'test.png', 'image/png', { knownSize: 1 });
    expect(state.finalize).toHaveBeenCalledWith(owner, 100, expect.any(Function));
  });
  it('adds a verified collection inside the quota transaction', async () => {
    await createMediaFromPath(owner, '/tmp/upload', 'test.png', 'image/png', { collectionId: 3n });
    expect(state.findCollection).toHaveBeenCalledWith({ where: { id: 3n, user_id: 1n } });
    expect(state.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          collections: { create: { collection_id: 3n } },
        }),
      }),
    );
  });
  it('cleans stored files if a collection disappears before finalization', async () => {
    state.findCollection.mockResolvedValue(null);
    const result = await createMediaFromPath(owner, '/tmp/upload', 'test.png', 'image/png', {
      collectionId: 3n,
    });
    expect(result).toMatchObject({ error: { status: 404 } });
    expect(state.create).not.toHaveBeenCalled();
    expect(state.remove).toHaveBeenCalledWith('/safe/stored.png');
  });
  it('rejects unknown file paths before storage', async () => {
    state.stat.mockResolvedValue(null);
    expect(await createMediaFromPath(owner, '/missing', 'test.png', 'image/png')).toMatchObject({
      error: { status: 404 },
    });
    expect(state.store).not.toHaveBeenCalled();
  });
  it('rejects zero or invalid file sizes', async () => {
    state.stat.mockResolvedValue({ size: 0 });
    expect(await createMediaFromPath(owner, '/tmp/upload', 'test.png', 'image/png')).toMatchObject({
      error: { status: 422 },
    });
  });
  it('rejects files larger than the instance maximum', async () => {
    state.stat.mockResolvedValue({ size: 6 * 1024 * 1024 });
    expect(await createMediaFromPath(owner, '/tmp/upload', 'test.png', 'image/png')).toMatchObject({
      error: { status: 413 },
    });
    expect(state.store).not.toHaveBeenCalled();
  });
  it('does not enforce retired MIME restrictions during finalization', async () => {
    state.settings.mockResolvedValue({ maxUploadSize: 0, allowedFileTypes: 'image/jpeg' });
    expect(await createMediaFromPath(owner, '/tmp/upload', 'test.png', 'image/png')).toMatchObject({
      data: { id: 2n },
    });
    expect(state.store).toHaveBeenCalled();
  });
  it('still rejects content that fails storage MIME validation', async () => {
    state.store.mockRejectedValueOnce(new MagicByteError('File type does not match content'));
    expect(await createMediaFromPath(owner, '/tmp/upload', 'test.png', 'image/png')).toMatchObject({
      error: { status: 422, message: 'File type does not match content' },
    });
    expect(state.create).not.toHaveBeenCalled();
  });
  it('cleans stored data on quota failure', async () => {
    state.finalize.mockResolvedValue({ ok: false, message: 'Quota exceeded', status: 400 });
    expect(await createMediaFromPath(owner, '/tmp/upload', 'test.png', 'image/png')).toMatchObject({
      error: { status: 400, message: 'Quota exceeded' },
    });
    expect(state.remove).toHaveBeenCalledWith('/safe/stored.png');
  });
  it('cleans stored data on database failure', async () => {
    state.finalize.mockRejectedValue(new Error('Database unavailable'));
    await expect(
      createMediaFromPath(owner, '/tmp/upload', 'test.png', 'image/png'),
    ).rejects.toThrow();
    expect(state.remove).toHaveBeenCalledWith('/safe/stored.png');
  });
  it('enqueues preview generation after successful finalization without waiting for it', async () => {
    const result = await createMediaFromPath(owner, '/tmp/upload', 'test.png', 'image/png');
    expect(result).toHaveProperty('data.id', 2n);
    expect(state.queue).toHaveBeenCalledWith(expect.any(Function), { mediaId: '2' });
    expect(state.preview).not.toHaveBeenCalled();
  });
});
