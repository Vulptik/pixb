import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerOptions } from '@tus/server';
import { Readable, Writable } from 'node:stream';
vi.mock('@/lib/server/storageStatus', async () => ({
  ...(await vi.importActual<typeof import('@/lib/server/storageStatus')>(
    '@/lib/server/storageStatus',
  )),
  assertStorageCapacity: vi.fn(async () => {}),
}));
const state = vi.hoisted(() => ({
  options: null as ServerOptions | null,
  getUpload: vi.fn(),
  auth: vi.fn(),
  settings: vi.fn(),
  findCollection: vi.fn(),
  findUpload: vi.fn(),
  create: vi.fn(),
  quota: vi.fn(),
  copy: vi.fn(),
  unlink: vi.fn(),
  write: vi.fn(),
}));
vi.mock('@tus/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tus/server')>()),
  Server: class {
    constructor(options: ServerOptions) {
      state.options = options;
    }
  },
}));
vi.mock('@tus/file-store', () => ({
  FileStore: class {
    getUpload = state.getUpload;
  },
}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    collection: { findFirst: state.findCollection },
    media: { findUnique: state.findUpload },
  },
}));
vi.mock('@/lib/server/auth', () => ({ getAuthFromCookieHeader: state.auth }));
vi.mock('@/lib/server/instance', () => ({ getInstanceSettings: state.settings }));
vi.mock('@/lib/server/storagePaths', () => ({ getTusStorageDir: async () => '/test/tus' }));
vi.mock('@/lib/server/tusStorage', () => ({
  ensureTusUploadDir: vi.fn(),
  getTusUploadPath: async (id: string) => `/test/tus/${id}`,
}));
vi.mock('@/lib/server/medias/create', () => ({ createMediaFromPath: state.create }));
vi.mock('@/lib/server/medias/quota', () => ({ checkUserQuotaSnapshot: state.quota }));
vi.mock('node:fs/promises', () => ({ copyFile: state.copy, unlink: state.unlink }));
vi.mock('node:fs', () => ({ createWriteStream: state.write }));
type Upload = Parameters<NonNullable<ServerOptions['onUploadCreate']>>[1];
const upload = (metadata: Record<string, string> = {}) =>
  ({
    id: 'up1',
    size: 100,
    offset: 100,
    metadata: { filename: 'test.png', filetype: 'image/png', pixb_owner: '1', ...metadata },
  }) as Upload;
async function boot() {
  await (await import('@/lib/server/tusServer')).getTusServer();
  return state.options!;
}
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  state.auth.mockResolvedValue({
    user: { id: 1n, quota: 1, cached_quota_used: 0n },
    session: { id: 2n },
  });
  state.settings.mockResolvedValue({ maxUploadSize: 10, allowedFileTypes: '' });
  state.findCollection.mockResolvedValue({ id: 3n, user_id: 1n });
  state.getUpload.mockResolvedValue(upload());
  state.findUpload.mockResolvedValue(null);
  state.create.mockResolvedValue({ data: { id: 4n } });
  state.quota.mockReturnValue(null);
  state.unlink.mockResolvedValue(undefined);
  state.copy.mockResolvedValue(undefined);
  state.write.mockImplementation(
    () =>
      new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      }),
  );
});
describe('resumable uploads for the new library', () => {
  it('reuses the initialized server and exposes the configured public URL and upload limit', async () => {
    const { getTusServer } = await import('@/lib/server/tusServer');
    const server = await getTusServer();
    expect(await getTusServer()).toBe(server);
    const options = state.options!;
    expect(await (options.maxSize as () => Promise<number>)()).toBe(10 * 1024 * 1024);
    state.settings.mockResolvedValue({ maxUploadSize: 0 });
    expect(await (options.maxSize as () => Promise<number>)()).toBe(0);
    expect(
      options.generateUrl!(new Request('http://local'), {
        proto: 'https',
        host: 'example.test',
        path: '/files',
        id: 'abc',
      }),
    ).toBe('https://example.test/files/abc');
  });
  it('lets unauthenticated preflight through without looking up an upload', async () => {
    const options = await boot();
    state.auth.mockResolvedValue(null);
    await options.onIncomingRequest!(new Request('http://local', { method: 'OPTIONS' }), '');
    expect(state.auth).not.toHaveBeenCalled();
    expect(state.getUpload).not.toHaveBeenCalled();
  });
  it('checks PATCH capacity and accepts POST without an existing upload', async () => {
    const options = await boot();
    const { assertStorageCapacity } = await import('@/lib/server/storageStatus');
    await options.onIncomingRequest!(new Request('http://local', { method: 'POST' }), '');
    expect(state.getUpload).not.toHaveBeenCalled();
    await options.onIncomingRequest!(
      new Request('http://local', {
        method: 'PATCH',
        headers: { 'content-length': '32' },
      }),
      'up1',
    );
    expect(assertStorageCapacity).toHaveBeenCalledWith('/test/tus', 32);
    await options.onIncomingRequest!(new Request('http://local', { method: 'PATCH' }), 'up1');
    expect(assertStorageCapacity).toHaveBeenCalledWith('/test/tus', 0);
  });
  it.each(['-1', 'NaN', '9007199254740992'])('rejects invalid PATCH size %s', async (size) => {
    const options = await boot();
    await expect(
      options.onIncomingRequest!(
        new Request('http://local', {
          method: 'PATCH',
          headers: { 'content-length': size },
        }),
        'up1',
      ),
    ).rejects.toMatchObject({ status_code: 400 });
  });
  it.each([0, NaN, 1.5])('rejects invalid declared upload size %s', async (size) => {
    const options = await boot();
    await expect(
      options.onUploadCreate!(new Request('http://local'), { ...upload(), size }),
    ).rejects.toMatchObject({ status_code: 422 });
  });
  it('rejects invalid collections before querying them and normalizes missing metadata', async () => {
    const options = await boot();
    await expect(
      options.onUploadCreate!(new Request('http://local'), upload({ collection: 'abc' })),
    ).rejects.toMatchObject({ status_code: 404 });
    expect(state.findCollection).not.toHaveBeenCalled();
    state.settings.mockResolvedValue({ maxUploadSize: 0 });
    expect(
      await options.onUploadCreate!(new Request('http://local'), { ...upload(), metadata: {} }),
    ).toMatchObject({ metadata: { filename: 'upload', filetype: 'application/octet-stream' } });
    expect(
      await options.onUploadCreate!(new Request('http://local'), {
        ...upload(),
        metadata: { name: 'photo.jpg', type: 'image/jpeg' },
      }),
    ).toMatchObject({ metadata: { filename: 'photo.jpg', filetype: 'image/jpeg' } });
  });
  it('rejects finalization for a different owner, including an existing library entry', async () => {
    const options = await boot();
    const req = new Request('http://local');
    await expect(options.onUploadFinish!(req, upload({ pixb_owner: '2' }))).rejects.toMatchObject({
      status_code: 404,
    });
    state.findUpload.mockResolvedValue({ id: 4n, user_id: 2n });
    await expect(options.onUploadFinish!(req, upload())).rejects.toMatchObject({
      status_code: 404,
    });
    expect(state.copy).not.toHaveBeenCalled();
  });
  it('uses safe finalization defaults and tolerates cleanup failure', async () => {
    const options = await boot();
    state.unlink.mockRejectedValueOnce(new Error('already removed'));
    await options.onUploadFinish!(new Request('http://local'), {
      ...upload(),
      size: undefined,
      metadata: { pixb_owner: '1' },
    });
    expect(state.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      'upload',
      'application/octet-stream',
      { isShared: false, collectionId: undefined, uploadId: 'up1' },
    );
  });
  it('does not retry finalization on incomplete or unsized HEAD requests', async () => {
    const options = await boot();
    for (const changes of [{ offset: 20 }, { size: undefined }]) {
      state.getUpload.mockResolvedValue({ ...upload(), ...changes });
      await options.onIncomingRequest!(new Request('http://local', { method: 'HEAD' }), 'up1');
    }
    expect(state.create).not.toHaveBeenCalled();
  });
  it('stops an aborted request before authentication or staging', async () => {
    const options = await boot();
    const controller = new AbortController();
    controller.abort();
    await expect(
      options.onUploadCreate!(
        new Request('http://local', {
          signal: controller.signal,
        }),
        upload(),
      ),
    ).rejects.toThrow();
    expect(state.auth).not.toHaveBeenCalled();
  });
  it('writes resumable chunks at the requested offset and periodically rechecks space', async () => {
    const options = await boot();
    const { assertStorageCapacity } = await import('@/lib/server/storageStatus');
    const chunks = [Buffer.alloc(10), Buffer.alloc(20), Buffer.alloc(1024 * 1024)];
    const store = options.datastore as unknown as {
      write(stream: Readable, id: string, offset: number): Promise<number>;
    };
    expect(await store.write(Readable.from(chunks), 'up1', 5)).toBe(35 + 1024 * 1024);
    expect(state.write).toHaveBeenCalledWith('/test/tus/up1', { flags: 'r+', start: 5 });
    expect(assertStorageCapacity).toHaveBeenCalledTimes(2);
  });
  it.each(['ENOSPC', 'unexpected'])('propagates a %s streaming failure', async (code) => {
    const options = await boot();
    const { assertStorageCapacity } = await import('@/lib/server/storageStatus');
    vi.mocked(assertStorageCapacity).mockRejectedValueOnce(
      Object.assign(new Error('failed'), { code }),
    );
    const store = options.datastore as unknown as {
      write(stream: Readable, id: string, offset: number): Promise<number>;
    };
    await expect(
      store.write(Readable.from([Buffer.from('bytes')]), 'up1', 0),
    ).rejects.toMatchObject(code === 'ENOSPC' ? { code: 'storageFull' } : { message: 'failed' });
  });
  it('retries finalization on HEAD before reporting a fully received upload as complete', async () => {
    const options = await boot();
    await options.onIncomingRequest!(
      new Request('http://local/files/up1', { method: 'HEAD' }),
      'up1',
    );
    expect(state.create).toHaveBeenCalled();
  });
  it('refuses completed HEAD when finalization still cannot write, preserving retryability', async () => {
    const options = await boot();
    state.copy.mockRejectedValueOnce(Object.assign(new Error('full'), { code: 'ENOSPC' }));
    await expect(
      options.onIncomingRequest!(new Request('http://local/files/up1', { method: 'HEAD' }), 'up1'),
    ).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(state.create).not.toHaveBeenCalled();
    expect(state.unlink).toHaveBeenCalledWith(expect.stringContaining('finalize-'));
  });
  it('maps raw filesystem failures to actionable TUS responses', async () => {
    const options = await boot();
    expect(
      await options.onResponseError!(
        new Request('http://local/files'),
        Object.assign(new Error('private dataset'), { code: 'ENOSPC' }),
      ),
    ).toEqual({ status_code: 507, body: 'storageFull' });
    expect(
      await options.onResponseError!(
        new Request('http://local/files'),
        Object.assign(new Error('private dataset'), { code: 'EROFS' }),
      ),
    ).toEqual({ status_code: 503, body: 'storageUnavailable' });
  });
  it('requires a session before creating uploads', async () => {
    const options = await boot();
    state.auth.mockResolvedValue(null);
    await expect(
      options.onUploadCreate!(new Request('http://local/files'), upload()),
    ).rejects.toMatchObject({ status_code: 401 });
  });
  it('handles concealed FileStore write errors without masking unrelated failures', async () => {
    const options = await boot();
    const { ERRORS } = await import('@tus/server');
    const { assertStorageCapacity, StorageError } = await import('@/lib/server/storageStatus');
    const request = new Request('http://local/files');
    vi.mocked(assertStorageCapacity).mockRejectedValueOnce(new StorageError('storageFull'));
    expect(await options.onResponseError!(request, ERRORS.FILE_WRITE_ERROR)).toEqual({
      status_code: 507,
      body: 'storageFull',
    });
    expect(await options.onResponseError!(request, ERRORS.FILE_WRITE_ERROR)).toEqual({
      status_code: 503,
      body: 'storageUnavailable',
    });
    expect(await options.onResponseError!(request, ERRORS.UNKNOWN_ERROR)).toBeUndefined();
  });
  it('binds upload ownership on the server and strips client privacy/owner overrides', async () => {
    const options = await boot();
    const result = await options.onUploadCreate!(
      new Request('http://local/files'),
      upload({ pixb_owner: '999', share: 'true', folder_id: '4' }),
    );
    expect(result.metadata).toEqual({
      filename: 'test.png',
      filetype: 'image/png',
      pixb_owner: '1',
    });
  });
  it('rejects collection destinations owned by another user', async () => {
    const options = await boot();
    state.findCollection.mockResolvedValue(null);
    await expect(
      options.onUploadCreate!(new Request('http://local/files'), upload({ collection: '3' })),
    ).rejects.toMatchObject({ status_code: 404 });
  });
  it('preserves a verified collection destination', async () => {
    const options = await boot();
    const result = await options.onUploadCreate!(
      new Request('http://local/files'),
      upload({ collection: '3' }),
    );
    expect(result.metadata).toMatchObject({ collection: '3', pixb_owner: '1' });
    expect(state.findCollection).toHaveBeenCalledWith({ where: { id: 3n, user_id: 1n } });
  });
  it('rejects over-quota batches before receiving file bytes', async () => {
    const options = await boot();
    state.quota.mockReturnValue({ status: 400, error: { message: 'Quota exceeded' } });
    await expect(
      options.onUploadCreate!(new Request('http://local/files'), upload()),
    ).rejects.toMatchObject({ status_code: 400 });
  });
  it('enforces configured maximum upload size', async () => {
    const options = await boot();
    state.settings.mockResolvedValue({ maxUploadSize: 1, allowedFileTypes: '' });
    await expect(
      options.onUploadCreate!(new Request('http://local/files'), {
        ...upload(),
        size: 2 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ status_code: 413 });
  });
  it('ignores retired MIME restrictions when starting resumable uploads', async () => {
    const options = await boot();
    state.settings.mockResolvedValue({ maxUploadSize: 10, allowedFileTypes: 'image/jpeg' });
    await expect(
      options.onUploadCreate!(new Request('http://local/files'), upload()),
    ).resolves.toMatchObject({ metadata: { filetype: 'image/png', pixb_owner: '1' } });
  });
  it.each(['HEAD', 'PATCH', 'DELETE'])(
    'rejects another user’s %s request on an existing upload',
    async (method) => {
      const options = await boot();
      state.getUpload.mockResolvedValue(upload({ pixb_owner: '2' }));
      await expect(
        options.onIncomingRequest!(new Request('http://local/files/up1', { method }), 'up1'),
      ).rejects.toMatchObject({ status_code: 404 });
    },
  );
  it('allows the same owner to resume', async () => {
    const options = await boot();
    await expect(
      options.onIncomingRequest!(new Request('http://local/files/up1', { method: 'HEAD' }), 'up1'),
    ).resolves.toBeUndefined();
  });
  it('finishes uploads as private and adds the verified collection', async () => {
    const options = await boot();
    const result = await options.onUploadFinish!(
      new Request('http://local/files/up1'),
      upload({ collection: '3', share: 'true' }),
    );
    expect(state.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1n }),
      expect.stringContaining('finalize-'),
      'test.png',
      'image/png',
      { isShared: false, collectionId: 3n, uploadId: 'up1' },
    );
    expect(result.headers).toEqual({ 'X-Pixb-File': '4' });
  });
  it('handles a lost final response without creating a second file', async () => {
    const options = await boot();
    state.findUpload.mockResolvedValue({ id: 4n, user_id: 1n });
    expect((await options.onUploadFinish!(new Request('http://local'), upload())).headers).toEqual({
      'X-Pixb-File': '4',
    });
    expect(state.create).not.toHaveBeenCalled();
    expect(state.copy).not.toHaveBeenCalled();
  });
  it('propagates finalization failure without reporting success', async () => {
    const options = await boot();
    state.create.mockResolvedValue({ error: { message: 'Quota exceeded', status: 400 } });
    await expect(
      options.onUploadFinish!(new Request('http://local'), upload()),
    ).rejects.toMatchObject({ status_code: 400 });
    expect(state.unlink).toHaveBeenCalled();
  });
});
