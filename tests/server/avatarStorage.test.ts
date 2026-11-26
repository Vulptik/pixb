import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
}));

const sharpMock = vi.hoisted(() => {
  const mockSharp = vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    gif: vi.fn().mockReturnThis(),
    toFile: vi.fn().mockResolvedValue(undefined),
  }));
  return { default: mockSharp };
});

vi.mock('fs/promises', () => fsMock);
vi.mock('sharp', () => sharpMock);
vi.mock('@/lib/server/storagePaths', () => ({
  getMediaStorageDir: vi.fn(async () => '/test/storage'),
}));

describe('avatar storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('preserves animated GIF output for every avatar size', async () => {
    const { storeAvatarFile, storeAvatarDataUrl } = await import('@/lib/server/avatars/storage');
    const result = await storeAvatarFile(
      new File(['gif'], 'animated.gif', { type: 'image/gif' }),
      5n,
    );
    expect(result.mimeType).toBe('image/gif');
    expect(result.filename).toMatch(/_large\.gif$/);
    for (const image of sharpMock.default.mock.results) {
      expect(image.value.gif).toHaveBeenCalledOnce();
      expect(image.value.webp).not.toHaveBeenCalled();
    }
    expect((await storeAvatarDataUrl('data:image/gif;base64,Z2lm', 5n)).mimeType).toBe('image/gif');
  });
  it.each([
    ['', ''],
    ['', 'application/unknown'],
    ['', 'image/jpeg'],
  ])('handles missing filename %j and MIME %j', async (name, type) => {
    const { storeAvatarFile } = await import('@/lib/server/avatars/storage');
    expect(await storeAvatarFile(new File(['bytes'], name, { type }), 5n)).toMatchObject({
      mimeType: 'image/webp',
    });
  });
  it('logs failed avatar cleanup without blocking account deletion', async () => {
    const { deleteAllUserAvatars } = await import('@/lib/server/avatars/storage');
    fsMock.rm.mockRejectedValueOnce(new Error('permission denied'));
    await expect(deleteAllUserAvatars(5n)).resolves.toBeUndefined();
  });

  it('stores avatar file', async () => {
    const { storeAvatarFile } = await import('@/lib/server/avatars/storage');
    const file = new File([new Uint8Array([1, 2])], 'avatar.png', { type: 'image/png' });
    const result = await storeAvatarFile(file, 5n);
    expect(result.mimeType).toBe('image/webp'); // Converted to WebP
    expect(result.filename).toMatch(/^[a-f0-9]{32}_large\.webp$/);
    expect(result.path).toMatch(/5[/\\]profile_picture[/\\][a-f0-9]{32}_large\.webp/);
    expect(fsMock.mkdir).toHaveBeenCalled();
    // Should create 3 variants (small, medium, large)
    expect(sharpMock.default).toHaveBeenCalledTimes(3);
  });

  it('stores avatar data URL', async () => {
    const { storeAvatarDataUrl } = await import('@/lib/server/avatars/storage');
    const dataUrl = `data:image/png;base64,${Buffer.from('hi').toString('base64')}`;
    const result = await storeAvatarDataUrl(dataUrl, 7n);
    expect(result.filename).toMatch(/^[a-f0-9]{32}_large\.webp$/); // Random hex name with _large suffix and webp extension
    expect(result.path).toMatch(/7[/\\]profile_picture[/\\]/);
    expect(fsMock.mkdir).toHaveBeenCalled();
    // Should create 3 variants (small, medium, large)
    expect(sharpMock.default).toHaveBeenCalledTimes(3);
  });

  it('throws on invalid data URL', async () => {
    const { storeAvatarDataUrl } = await import('@/lib/server/avatars/storage');
    await expect(storeAvatarDataUrl('not-a-data-url', 1n)).rejects.toThrow('Invalid data URL');
  });

  it('deletes all user avatars', async () => {
    const { deleteAllUserAvatars } = await import('@/lib/server/avatars/storage');
    await deleteAllUserAvatars(5n);
    expect(fsMock.rm).toHaveBeenCalledWith(expect.stringMatching(/5[/\\]profile_picture/), {
      recursive: true,
      force: true,
    });
  });
});
