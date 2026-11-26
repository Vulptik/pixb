import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const db = vi.hoisted(() => ({ media: { findFirst: vi.fn() } }));
const access = vi.hoisted(() => vi.fn());
const storage = vi.hoisted(() => ({ root: '', thumb: vi.fn(), cover: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: db }));
vi.mock('@/lib/server/medias/accessKey', () => ({ authorizeMediaRequestAccess: access }));
vi.mock('@/lib/server/storagePaths', () => ({ getMediaStorageDir: async () => storage.root }));
vi.mock('@/lib/server/medias/storage', () => ({
  ensureMediaThumbnail: storage.thumb,
  ensureMediaCover: storage.cover,
}));
import { serveFile } from '@/lib/server/fileProxy';
let filePath: string;
beforeAll(async () => {
  storage.root = await mkdtemp(path.join(os.tmpdir(), 'pixb-file-test-'));
  filePath = path.join(storage.root, 'file.bin');
  await writeFile(filePath, '0123456789');
});
afterAll(async () => {
  if (!path.basename(storage.root).startsWith('pixb-file-test-')) throw Error('Unsafe cleanup');
  await rm(storage.root, { recursive: true, force: true });
});
beforeEach(() => {
  vi.clearAllMocks();
  db.media.findFirst.mockResolvedValue({
    id: 1n,
    uid: 'file-uid',
    filename: 'test.jpg',
    mime_type: 'image/jpeg',
    file_data: filePath,
    user_id: 1n,
    is_shared: false,
  });
  access.mockResolvedValue({ ok: true, owns: true });
  storage.thumb.mockResolvedValue(filePath);
  storage.cover.mockResolvedValue(filePath);
});
describe('authorized file responses', () => {
  it.each([false, true])(
    'serves extension-bearing originals with download=%s',
    async (download) => {
      const response = await serveFile({
        virtualPath: 'file-uid.jpg',
        variant: 'original',
        download,
      });
      expect(db.media.findFirst).toHaveBeenCalledWith({ where: { uid: 'file-uid' } });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-disposition')).toContain(
        download ? 'attachment' : 'inline',
      );
      expect(await response.text()).toBe('0123456789');
    },
  );
  it('keeps the stored MIME type even if a URL suffix is changed', async () => {
    const response = await serveFile({ virtualPath: 'file-uid.mp4', variant: 'original' });
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    await response.text();
  });
  it('denies extension-bearing private and revoked links', async () => {
    access.mockResolvedValue({ ok: false, status: 404 });
    expect((await serveFile({ virtualPath: 'file-uid.jpg', variant: 'original' })).status).toBe(
      404,
    );
    db.media.findFirst.mockResolvedValue(null);
    expect((await serveFile({ virtualPath: 'old-uid.jpg', variant: 'original' })).status).toBe(404);
  });
  it.each(['original', 'thumb', 'cover', 'pdf'] as const)(
    'denies private %s assets before reading storage',
    async (variant) => {
      access.mockResolvedValue({ ok: false, status: 404 });
      const r = await serveFile({ virtualPath: 'file-uid', variant });
      expect(r.status).toBe(404);
      expect(storage.thumb).not.toHaveBeenCalled();
      expect(storage.cover).not.toHaveBeenCalled();
    },
  );
  it('returns the complete image without public caching', async () => {
    const r = await serveFile({ virtualPath: 'file-uid', variant: 'original' });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('0123456789');
    expect(r.headers.get('content-disposition')).toContain('inline');
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it.each(['text/html', 'image/svg+xml', 'text/javascript', 'application/zip'])(
    'forces %s to download',
    async (mime) => {
      db.media.findFirst.mockResolvedValue({
        mime_type: mime,
        filename: 'unsafe.html',
        file_data: filePath,
      });
      const r = await serveFile({ virtualPath: 'file-uid', variant: 'original' });
      expect(r.headers.get('content-disposition')).toContain('attachment');
      await r.text();
    },
  );
  it('serves a PDF inline only through its authorized preview route', async () => {
    db.media.findFirst.mockResolvedValue({
      mime_type: 'application/pdf',
      filename: 'paper.pdf',
      file_data: filePath,
    });
    const original = await serveFile({ virtualPath: 'file-uid', variant: 'original' });
    expect(original.headers.get('content-disposition')).toContain('attachment');
    await original.text();
    const preview = await serveFile({ virtualPath: 'file-uid', variant: 'pdf' });
    expect(preview.headers.get('content-disposition')).toContain('inline');
    expect(preview.headers.get('content-type')).toBe('application/pdf');
    await preview.text();
  });
  it('does not use the PDF preview route to render HTML', async () => {
    db.media.findFirst.mockResolvedValue({ mime_type: 'text/html', file_data: filePath });
    expect((await serveFile({ virtualPath: 'file-uid', variant: 'pdf' })).status).toBe(404);
  });
  it('forces download even for visual originals when requested', async () => {
    const r = await serveFile({ virtualPath: 'file-uid', variant: 'original', download: true });
    expect(r.headers.get('content-disposition')).toContain('attachment');
    await r.text();
  });
  it('supports playback byte ranges', async () => {
    const r = await serveFile({
      virtualPath: 'file-uid',
      variant: 'original',
      request: new Request('http://local', { headers: { range: 'bytes=2-5' } }),
    });
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await r.text()).toBe('2345');
  });
  it('supports suffix ranges', async () => {
    const r = await serveFile({
      virtualPath: 'file-uid',
      variant: 'original',
      request: new Request('http://local', { headers: { range: 'bytes=-3' } }),
    });
    expect(await r.text()).toBe('789');
  });
  it.each(['bytes=99-', 'bytes=5-2', 'bytes=', 'bytes=0-1,4-5'])(
    'rejects invalid range %s',
    async (range) => {
      expect(
        (
          await serveFile({
            virtualPath: 'file-uid',
            variant: 'original',
            request: new Request('http://local', { headers: { range } }),
          })
        ).status,
      ).toBe(416);
    },
  );
  it('returns headers without opening a body for HEAD', async () => {
    const r = await serveFile({
      virtualPath: 'file-uid',
      variant: 'original',
      request: new Request('http://local', { method: 'HEAD' }),
    });
    expect(r.body).toBeNull();
    expect(r.headers.get('content-length')).toBe('10');
  });
  it('rejects storage traversal on the host platform', async () => {
    db.media.findFirst.mockResolvedValue({
      mime_type: 'image/jpeg',
      file_data: path.join(storage.root, '..', 'outside.jpg'),
    });
    await expect(serveFile({ virtualPath: 'file-uid', variant: 'original' })).rejects.toThrow(
      'Invalid file path',
    );
  });
  it('returns not found for removed UIDs and missing derivatives', async () => {
    db.media.findFirst.mockResolvedValueOnce(null);
    expect((await serveFile({ virtualPath: 'old-uid', variant: 'original' })).status).toBe(404);
    storage.thumb.mockResolvedValue(null);
    expect((await serveFile({ virtualPath: 'file-uid', variant: 'thumb' })).status).toBe(404);
  });
});
