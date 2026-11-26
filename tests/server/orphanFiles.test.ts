import { mkdtemp, mkdir, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readDirectory = vi.hoisted(() => vi.fn());
const readStat = vi.hoisted(() => vi.fn());
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  readDirectory.mockImplementation(actual.readdir);
  readStat.mockImplementation(actual.stat);
  return { ...actual, readdir: readDirectory, stat: readStat };
});

const prismaMock = vi.hoisted(() => ({
  media: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  user: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
}));

const storageMock = vi.hoisted(() => ({
  dir: '',
  getMediaStorageDir: vi.fn(async () => storageMock.dir),
}));

const uidMock = vi.hoisted(() => ({
  generateUniqueMediaUid: vi.fn(async () => 'reattached_uid'),
}));

const mediaStorageMock = vi.hoisted(() => ({
  ensureMediaThumbnail: vi.fn(async () => '/tmp/thumb.webp'),
  ensureMediaCover: vi.fn(async () => '/tmp/cover.webp'),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/server/storagePaths', () => storageMock);

vi.mock('@/lib/server/medias/uid', () => uidMock);

vi.mock('@/lib/server/medias/storage', () => mediaStorageMock);

describe('orphan file maintenance', () => {
  let storageDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    storageDir = await mkdtemp(path.join(tmpdir(), 'pixb-orphans-'));
    storageMock.dir = storageDir;

    await mkdir(path.join(storageDir, '1', 'media', 'thumbnails'), { recursive: true });
    await writeFile(path.join(storageDir, '1', 'media', 'live.jpg'), 'live');
    await writeFile(path.join(storageDir, '1', 'media', 'thumbnails', 'live.webp'), 'thumb');
    await writeFile(path.join(storageDir, '1', 'media', 'orphan.png'), 'orphan');
    await writeFile(path.join(storageDir, '1', 'media', 'thumbnails', 'old.webp'), 'old');
    await writeFile(path.join(storageDir, 'loose.bin'), 'loose');

    prismaMock.media.findMany.mockResolvedValue([
      { file_data: path.join(storageDir, '1', 'media', 'live.jpg') },
    ]);
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.user.findFirst.mockResolvedValue({ id: 1n });
    prismaMock.media.create.mockImplementation(async ({ data }) => ({
      id: 9n,
      ...data,
    }));
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  it('lists files that are not referenced by media records', async () => {
    const { scanOrphanFiles } = await import('@/lib/server/orphanFiles');

    const result = await scanOrphanFiles();
    const paths = result.items.map((item) => item.relativePath).sort();

    expect(paths).toEqual(['1/media/orphan.png', '1/media/thumbnails/old.webp', 'loose.bin']);
    expect(result.items.find((item) => item.relativePath === '1/media/orphan.png')).toMatchObject({
      kind: 'media',
      canReattach: true,
      userId: '1',
      reasonKey: 'mediaMissingRecord',
    });
    expect(
      result.items.find((item) => item.relativePath === '1/media/thumbnails/old.webp'),
    ).toMatchObject({
      kind: 'derivative',
      canReattach: false,
      reasonKey: 'previewMissingRecord',
    });
  });

  it.each(['EACCES', 'EIO'])(
    'rejects incomplete scans when reading storage fails with %s',
    async (code) => {
      const { scanOrphanFiles } = await import('@/lib/server/orphanFiles');
      const failure = Object.assign(new Error('Storage directory could not be read'), { code });
      readDirectory.mockRejectedValueOnce(failure);

      await expect(scanOrphanFiles()).rejects.toBe(failure);
    },
  );

  it('tolerates a storage directory disappearing during a scan', async () => {
    const { scanOrphanFiles } = await import('@/lib/server/orphanFiles');
    readDirectory.mockRejectedValueOnce(
      Object.assign(new Error('Missing directory'), { code: 'ENOENT' }),
    );

    expect(await scanOrphanFiles()).toMatchObject({ items: [], scannedFiles: 0, truncated: false });
  });

  it('rejects an incomplete scan when reading file metadata fails', async () => {
    const { scanOrphanFiles } = await import('@/lib/server/orphanFiles');
    const failure = Object.assign(new Error('File metadata unavailable'), { code: 'EIO' });
    readStat.mockRejectedValueOnce(failure);

    await expect(scanOrphanFiles()).rejects.toBe(failure);
  });

  it('does not list stored profile picture variants as orphaned', async () => {
    const avatarDir = path.join(storageDir, '1', 'profile_picture');
    await mkdir(avatarDir, { recursive: true });
    const largePath = path.join(avatarDir, 'avatar_large.webp');
    await Promise.all([
      writeFile(largePath, 'large'),
      writeFile(path.join(avatarDir, 'avatar_medium.webp'), 'medium'),
      writeFile(path.join(avatarDir, 'avatar_small.webp'), 'small'),
    ]);
    prismaMock.user.findMany.mockResolvedValue([{ avatar_data: largePath }]);
    const { scanOrphanFiles } = await import('@/lib/server/orphanFiles');

    const result = await scanOrphanFiles();

    expect(result.items.map((item) => item.relativePath)).not.toEqual(
      expect.arrayContaining([
        '1/profile_picture/avatar_large.webp',
        '1/profile_picture/avatar_medium.webp',
        '1/profile_picture/avatar_small.webp',
      ]),
    );
  });

  it('deletes only files that still scan as orphaned', async () => {
    const { deleteOrphanFile } = await import('@/lib/server/orphanFiles');

    await deleteOrphanFile('1/media/orphan.png');

    await expect(stat(path.join(storageDir, '1', 'media', 'orphan.png'))).rejects.toThrow();
    await expect(deleteOrphanFile('1/media/live.jpg')).rejects.toThrow(
      'File is no longer orphaned',
    );
  });

  it('rejects path traversal attempts', async () => {
    const { deleteOrphanFile } = await import('@/lib/server/orphanFiles');

    await expect(deleteOrphanFile('../outside.txt')).rejects.toThrow('Invalid storage path');
    await expect(deleteOrphanFile('/tmp/outside.txt')).rejects.toThrow('Invalid storage path');
  });
});
