import path from 'path';
import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/server/storageStatus', () => ({ assertStorageCapacity: vi.fn() }));

const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  copyFile: vi.fn(),
  unlink: vi.fn(),
  stat: vi.fn(),
  rm: vi.fn(),
  readdir: vi.fn(),
  open: vi.fn().mockResolvedValue({
    read: vi.fn().mockResolvedValue({ bytesRead: 0, buffer: Buffer.alloc(4100) }),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

const randomBytesMock = vi.hoisted(() => vi.fn(() => Buffer.alloc(16, 1)));
const spawnMock = vi.hoisted(() =>
  vi.fn(() => {
    const child: EventEmitter & { kill: ReturnType<typeof vi.fn> } = Object.assign(
      new EventEmitter(),
      { kill: vi.fn() },
    );
    setImmediate(() => child.emit('close', 0));
    return child;
  }),
);

const sharpInstance = {
  metadata: vi.fn(),
  resize: vi.fn().mockReturnThis(),
  toFormat: vi.fn().mockReturnThis(),
  toFile: vi.fn(),
};

const sharpMock = vi.hoisted(() => vi.fn(() => sharpInstance));
const fileTypeMock = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock('fs/promises', () => fsMock);
vi.mock('crypto', () => ({
  default: { randomBytes: randomBytesMock },
}));
vi.mock('sharp', () => ({
  default: sharpMock,
}));
vi.mock('child_process', () => ({
  spawn: spawnMock,
}));
vi.mock('file-type', () => ({
  fileTypeFromBuffer: fileTypeMock,
}));

describe('media storage helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.FFMPEG_PATH;
    delete process.env.FFMPEG_BIN;
    // Reset stat mock to clear any leftover mockResolvedValueOnce queue
    fsMock.stat.mockReset();
    sharpInstance.metadata.mockResolvedValue({ width: 100, height: 100, size: 1000 });
    sharpInstance.toFile.mockResolvedValue(undefined);
    fsMock.open.mockResolvedValue({
      read: vi.fn().mockResolvedValue({ bytesRead: 0, buffer: Buffer.alloc(4100) }),
      close: vi.fn().mockResolvedValue(undefined),
    });
    fsMock.stat.mockResolvedValue({ size: 999 });
    fileTypeMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds thumbnail path', async () => {
    const { getMediaThumbnailPath } = await import('@/lib/server/medias/storage');
    const thumbPath = getMediaThumbnailPath(
      path.join('storage', 'uploads', '1', 'media', 'file.jpg'),
    );
    expect(thumbPath).toContain(
      path.join('storage', 'uploads', '1', 'media', 'thumbnails', 'file.webp'),
    );
  });

  it('builds cover path', async () => {
    const { getMediaCoverPath } = await import('@/lib/server/medias/storage');
    const coverPath = getMediaCoverPath(path.join('storage', 'uploads', '1', 'media', 'file.mp4'));
    expect(coverPath).toContain(
      path.join('storage', 'uploads', '1', 'media', 'covers', 'file.webp'),
    );
  });

  it('returns existing generated thumbnail and cover paths', async () => {
    const { ensureMediaThumbnail, ensureMediaCover } = await import('@/lib/server/medias/storage');
    fsMock.stat.mockResolvedValue({ size: 999 });

    await expect(ensureMediaThumbnail('/tmp/photo.png', 'image/png')).resolves.toBe(
      path.join('/tmp', 'thumbnails', 'photo.webp'),
    );
    await expect(ensureMediaCover('/tmp/video.mp4', 'video/mp4')).resolves.toBe(
      path.join('/tmp', 'covers', 'video.webp'),
    );

    expect(spawnMock).not.toHaveBeenCalled();
    expect(sharpMock).not.toHaveBeenCalled();
  });

  it('returns null for thumbnail and cover unsupported mime types', async () => {
    const { ensureMediaThumbnail, ensureMediaCover } = await import('@/lib/server/medias/storage');

    await expect(ensureMediaThumbnail('/tmp/doc.pdf', 'application/pdf')).resolves.toBeNull();
    await expect(ensureMediaCover('/tmp/photo.png', 'image/png')).resolves.toBeNull();
  });

  it('generates missing image thumbnails on demand', async () => {
    fsMock.stat.mockRejectedValueOnce(new Error('missing'));
    const { ensureMediaThumbnail } = await import('@/lib/server/medias/storage');

    await expect(ensureMediaThumbnail('/tmp/photo.png', 'image/png')).resolves.toBe(
      path.join('/tmp', 'thumbnails', 'photo.webp'),
    );

    expect(sharpInstance.resize).toHaveBeenCalled();
  });

  it('extracts one video frame for both preview sizes and removes the intermediate', async () => {
    const { generateMediaPreview } = await import('@/lib/server/medias/storage');

    await generateMediaPreview('/tmp/clip.mp4', 'video/mp4');

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(sharpInstance.toFile).toHaveBeenCalledWith(path.join('/tmp', 'thumbnails', 'clip.webp'));
    expect(sharpInstance.toFile).toHaveBeenCalledWith(path.join('/tmp', 'covers', 'clip.webp'));
    expect(sharpInstance.resize).toHaveBeenCalledWith(200, 200, expect.any(Object));
    expect(sharpInstance.resize).toHaveBeenCalledWith(1280, 720, expect.any(Object));
    expect(fsMock.rm).toHaveBeenCalledWith(expect.stringContaining('.frame-'), { force: true });
  });

  it('shares frame extraction between background and concurrent on-demand requests', async () => {
    fsMock.stat.mockImplementation(async (file) => ({
      size: String(file).endsWith('.webp') ? 0 : 999,
    }));
    const storage = await import('@/lib/server/medias/storage');
    await Promise.all([
      storage.generateMediaPreview('/tmp/clip.mp4', 'video/mp4'),
      storage.ensureMediaThumbnail('/tmp/clip.mp4', 'video/mp4'),
      storage.ensureMediaCover('/tmp/clip.mp4', 'video/mp4'),
    ]);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(sharpInstance.toFile).toHaveBeenCalledTimes(2);
  });

  it('cleans up a failed frame extraction and permits a later retry', async () => {
    for (let i = 0; i < 2; i++) {
      spawnMock.mockImplementationOnce(() => {
        const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
        setImmediate(() => child.emit('close', 1));
        return child;
      });
    }
    const storage = await import('@/lib/server/medias/storage');
    await expect(storage.generateMediaPreview('/tmp/clip.mp4', 'video/mp4')).rejects.toThrow(
      'ffmpeg exited with code 1',
    );
    expect(sharpMock).not.toHaveBeenCalled();
    expect(fsMock.rm).toHaveBeenCalledWith(expect.stringContaining('.frame-'), { force: true });
    await storage.generateMediaPreview('/tmp/clip.mp4', 'video/mp4');
    expect(spawnMock).toHaveBeenCalledTimes(3);
    expect(sharpInstance.toFile).toHaveBeenCalledTimes(2);
  });

  it('cleans up the intermediate if image processing fails', async () => {
    sharpInstance.toFile.mockRejectedValueOnce(new Error('disk full'));
    const { generateMediaPreview } = await import('@/lib/server/medias/storage');
    await expect(generateMediaPreview('/tmp/clip.mp4', 'video/mp4')).rejects.toThrow('disk full');
    expect(fsMock.rm).toHaveBeenCalledWith(expect.stringContaining('.frame-'), { force: true });
  });

  it.each(['thumb', 'cover'] as const)(
    'retries the first frame for an empty %s from a short video',
    async (variant) => {
      const storage = await import('@/lib/server/medias/storage');
      const target =
        variant === 'thumb'
          ? storage.getMediaThumbnailPath('/tmp/short.mp4')
          : storage.getMediaCoverPath('/tmp/short.mp4');
      let frameReads = 0;
      fsMock.stat.mockImplementation(async (file) => ({
        size: file === target || (String(file).includes('.frame-') && ++frameReads === 1) ? 8 : 999,
      }));
      const result = await (
        variant === 'thumb' ? storage.ensureMediaThumbnail : storage.ensureMediaCover
      )('/tmp/short.mp4', 'video/mp4');
      expect(result).toBe(target);
      expect(spawnMock.mock.calls.some(([, args]) => args.includes('00:00:00.000'))).toBe(true);
    },
  );

  it('uses configured ffmpeg binary for video previews', async () => {
    process.env.FFMPEG_PATH = '/opt/pixb/bin/ffmpeg';
    const { generateMediaPreview } = await import('@/lib/server/medias/storage');

    await generateMediaPreview('/tmp/clip.mp4', 'video/mp4');

    expect(spawnMock).toHaveBeenCalledWith(
      '/opt/pixb/bin/ffmpeg',
      expect.any(Array),
      expect.any(Object),
    );
  });

  it('falls back to FFMPEG_BIN when FFMPEG_PATH is unavailable', async () => {
    process.env.FFMPEG_PATH = '/invalid/ffmpeg';
    process.env.FFMPEG_BIN = '/opt/pixb/bin/ffmpeg';
    fsMock.stat.mockRejectedValueOnce(new Error('missing'));
    const { generateMediaPreview } = await import('@/lib/server/medias/storage');

    await generateMediaPreview('/tmp/clip.mp4', 'video/mp4');
    expect(spawnMock).toHaveBeenCalledWith(
      '/opt/pixb/bin/ffmpeg',
      expect.any(Array),
      expect.any(Object),
    );
  });

  it('uses system ffmpeg without looking for the development binary in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { generateMediaPreview } = await import('@/lib/server/medias/storage');

    await generateMediaPreview('/tmp/clip.mp4', 'video/mp4');
    expect(spawnMock).toHaveBeenCalledWith(
      '/usr/bin/ffmpeg',
      expect.any(Array),
      expect.any(Object),
    );
  });

  it('moves file from path with EXDEV fallback', async () => {
    const { storeMediaFileFromPath } = await import('@/lib/server/medias/storage');
    fsMock.rename.mockRejectedValueOnce({ code: 'EXDEV' });
    fsMock.stat.mockImplementation(() => Promise.resolve({ size: 12 }));

    const result = await storeMediaFileFromPath('/tmp/source.txt', 'source.txt', 'text/plain', 3n);

    expect(fsMock.stat).toHaveBeenCalled();
    expect(fsMock.copyFile).toHaveBeenCalled();
    expect(fsMock.unlink).toHaveBeenCalled();
    expect(result.size).toBe(12);
  });

  it('removes a partial cross-filesystem copy on disk-full failure without deleting the source', async () => {
    const { storeMediaFileFromPath } = await import('@/lib/server/medias/storage');
    fsMock.rename.mockRejectedValueOnce({ code: 'EXDEV' });
    fsMock.copyFile.mockRejectedValueOnce(Object.assign(new Error('full'), { code: 'ENOSPC' }));
    await expect(
      storeMediaFileFromPath('/tmp/source.txt', 'source.txt', 'text/plain', 3n),
    ).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(fsMock.unlink).not.toHaveBeenCalled();
    expect(fsMock.rm).toHaveBeenCalledWith(expect.any(String), { force: true });
    expect(fsMock.rm.mock.calls.every(([file]) => file !== '/tmp/source.txt')).toBe(true);
  });
  it('throws non-EXDEV move failures', async () => {
    const { storeMediaFileFromPath } = await import('@/lib/server/medias/storage');
    fsMock.rename.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));

    await expect(
      storeMediaFileFromPath('/tmp/source.txt', 'source.txt', 'text/plain', 3n),
    ).rejects.toThrow('denied');

    expect(fsMock.copyFile).not.toHaveBeenCalled();
  });

  it('rejects binary content declared as text', async () => {
    const { storeMediaFileFromPath, MagicByteError } = await import('@/lib/server/medias/storage');
    fsMock.rename.mockResolvedValueOnce(undefined);
    fsMock.open.mockResolvedValueOnce({
      read: vi.fn().mockImplementation(async (buffer: Buffer) => {
        buffer[0] = 0;
        return { bytesRead: 1, buffer };
      }),
      close: vi.fn().mockResolvedValue(undefined),
    });

    await expect(
      storeMediaFileFromPath('/tmp/source.txt', 'source.txt', 'text/plain', 3n),
    ).rejects.toBeInstanceOf(MagicByteError);
  });

  it('rejects path uploads whose detected MIME category does not match the declaration', async () => {
    const { storeMediaFileFromPath, MagicByteError } = await import('@/lib/server/medias/storage');
    fileTypeMock.mockResolvedValueOnce({ mime: 'application/pdf', ext: 'pdf' });
    await expect(
      storeMediaFileFromPath('/tmp/photo.png', 'photo.png', 'image/png', 1n),
    ).rejects.toBeInstanceOf(MagicByteError);
    expect(fsMock.rm).toHaveBeenCalled();
  });

  it('deletes media files and prunes empty directories', async () => {
    const { deleteMediaFiles } = await import('@/lib/server/medias/storage');
    const filePath = path.join('storage', 'test-uploads', '4', 'media', 'file.jpg');
    fsMock.readdir.mockResolvedValue([]);

    await deleteMediaFiles(filePath);

    expect(fsMock.rm).toHaveBeenCalledWith(filePath, { force: true });
    const thumbPath = path.join('storage', 'test-uploads', '4', 'media', 'thumbnails', 'file.webp');
    expect(fsMock.rm).toHaveBeenCalledWith(thumbPath, { force: true });
    const coverPath = path.join('storage', 'test-uploads', '4', 'media', 'covers', 'file.webp');
    expect(fsMock.rm).toHaveBeenCalledWith(coverPath, { force: true });
  });
});
