import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  session: vi.fn(),
  key: vi.fn(),
  scope: vi.fn(),
  parse: vi.fn(),
  create: vi.fn(),
  settings: vi.fn(),
  collection: vi.fn(),
  unlink: vi.fn(),
  limit: vi.fn(),
}));
vi.mock('@/lib/server/auth', () => ({
  getAuthFromRequest: state.session,
  getApiKeyFromRequest: state.key,
  apiKeyHasScope: state.scope,
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: { collection: { findFirst: state.collection } } }));
vi.mock('@/lib/server/medias/create', () => ({ createMediaFromPath: state.create }));
vi.mock('@/lib/server/instance', () => ({ getInstanceSettings: state.settings }));
vi.mock('@/lib/server/uploads/multipart', () => ({
  parseMultipartUpload: state.parse,
  MultipartUploadError: class extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/lib/server/appUrl', () => ({ getAppUrl: async () => 'http://local' }));
vi.mock('@/lib/server/rateLimit', () => ({ checkRateLimit: state.limit }));
vi.mock('node:fs/promises', () => ({ unlink: state.unlink }));
import { POST } from '@/app/api/v1/uploads/route';
const request = () =>
  new Request('http://local/api/v1/uploads', {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=x', authorization: 'Bearer key' },
  });
const context = { params: Promise.resolve({}) };
const fields = new Map<string, string>();
beforeEach(() => {
  vi.clearAllMocks();
  fields.clear();
  state.session.mockResolvedValue(null);
  state.key.mockResolvedValue({ user: { id: 1n, quota: 1 }, apiKey: { id: 1n } });
  state.scope.mockReturnValue(true);
  state.limit.mockReturnValue(true);
  state.settings.mockResolvedValue({ maxUploadSize: 5, allowedFileTypes: '' });
  state.parse.mockResolvedValue({
    file: { path: '/tmp/upload', filename: 'photo.jpg', mimeType: 'image/jpeg' },
    fields,
  });
  state.collection.mockResolvedValue({ id: 3n, user_id: 1n });
  state.unlink.mockResolvedValue(undefined);
  state.create.mockImplementation(async (_user, _path, _name, _mime, options) => ({
    data: {
      id: 1n,
      uid: 'public-id',
      user_id: 1n,
      filename: 'photo.jpg',
      mime_type: 'image/jpeg',
      size: 10n,
      created_at: new Date(),
      is_shared: options.isShared,
      is_favorite: false,
    },
  }));
});

it.each([
  ['ENOSPC', 507, 'storageFull'],
  ['EROFS', 503, 'storageUnavailable'],
] as const)(
  'returns actionable %s storage errors without leaking paths',
  async (errno, status, code) => {
    state.parse.mockRejectedValueOnce(
      Object.assign(new Error('failure at /private/dataset'), { code: errno }),
    );
    const response = await POST(request(), context);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ message: code, code });
  },
);
describe('multipart API uploader contract', () => {
  it('requires a valid key', async () => {
    state.key.mockResolvedValue(null);
    expect((await POST(request(), context)).status).toBe(401);
    expect(state.parse).not.toHaveBeenCalled();
  });
  it('requires write scope', async () => {
    state.scope.mockReturnValue(false);
    expect((await POST(request(), context)).status).toBe(403);
    expect(state.parse).not.toHaveBeenCalled();
  });
  it('applies the API upload rate limit', async () => {
    state.limit.mockReturnValue(false);
    expect((await POST(request(), context)).status).toBe(429);
    expect(state.create).not.toHaveBeenCalled();
  });
  it('rejects remote URL imports and JSON/text creation', async () => {
    const r = await POST(
      new Request('http://local', {
        method: 'POST',
        headers: { authorization: 'Bearer key', 'content-type': 'application/json' },
        body: JSON.stringify({ file_remote_url: 'https://example.com/file' }),
      }),
      context,
    );
    expect(r.status).toBe(422);
    expect(state.parse).not.toHaveBeenCalled();
  });
  it('uses bounded multipart parsing', async () => {
    await POST(request(), context);
    expect(state.parse).toHaveBeenCalledWith(expect.any(Request), {
      maxFileBytes: 5 * 1024 * 1024,
    });
  });
  it('rejects missing file fields', async () => {
    state.parse.mockResolvedValue({ file: null, fields });
    expect((await POST(request(), context)).status).toBe(422);
  });
  it('keeps uploads private by default and returns distinct raw/share links', async () => {
    const r = await POST(request(), context);
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body).toMatchObject({
      file: { id: '1', shared: false },
      shareUrl: null,
      rawUrl: 'http://local/raw/public-id.jpg',
    });
    expect(state.create).toHaveBeenCalledWith(
      expect.anything(),
      '/tmp/upload',
      'photo.jpg',
      'image/jpeg',
      expect.objectContaining({ isShared: false }),
    );
    expect(r.headers.get('cache-control')).toBe('private, no-store');
  });
  it('shares only when the client explicitly includes share=true', async () => {
    fields.set('share', 'true');
    const r = await POST(request(), context);
    expect(await r.json()).toMatchObject({
      file: { shared: true },
      shareUrl: 'http://local/s/public-id.jpg',
      rawUrl: 'http://local/raw/public-id.jpg',
    });
  });
  it.each(['false', '1', 'yes', ''])('does not implicitly share for %s', async (value) => {
    fields.set('share', value);
    expect((await (await POST(request(), context)).json()).file.shared).toBe(false);
  });
  it('verifies collection ownership before storage and cleans temporary input', async () => {
    fields.set('collection', '3');
    state.collection.mockResolvedValue(null);
    expect((await POST(request(), context)).status).toBe(404);
    expect(state.create).not.toHaveBeenCalled();
    expect(state.unlink).toHaveBeenCalledWith('/tmp/upload');
  });
  it('adds an owned collection and includes its membership in the response', async () => {
    fields.set('collection', '3');
    const r = await POST(request(), context);
    expect((await r.json()).file.collections).toEqual(['3']);
    expect(state.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ collectionId: 3n }),
    );
  });
  it('does not report a quota failure as a successful upload', async () => {
    state.create.mockResolvedValue({ error: { message: 'Quota exceeded', status: 400 } });
    const r = await POST(request(), context);
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ code: 'quotaExceeded' });
    expect(state.unlink).toHaveBeenCalled();
  });
  it('maps oversized-file errors and cleans temporary input', async () => {
    state.create.mockResolvedValue({
      error: { message: 'File exceeds upload limit', status: 413 },
    });
    const r = await POST(request(), context);
    expect(r.status).toBe(413);
    expect(await r.json()).toMatchObject({ code: 'fileTooLarge' });
    expect(state.unlink).toHaveBeenCalled();
  });
  it('does not expose storage paths or private credentials in the upload result', async () => {
    const text = await (await POST(request(), context)).text();
    expect(text).not.toMatch(/file_data|\/tmp\/upload|encoded_token|access_token/);
  });
});
