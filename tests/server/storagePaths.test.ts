import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';

const originalStoragePath = process.env.STORAGE_PATH;

describe('storage path helpers', () => {
  afterEach(() => {
    if (originalStoragePath === undefined) delete process.env.STORAGE_PATH;
    else process.env.STORAGE_PATH = originalStoragePath;
  });

  it('uses app storage by default', async () => {
    delete process.env.STORAGE_PATH;
    const { getMediaStorageDir, getTusStorageDir } = await import('@/lib/server/storagePaths');

    await expect(getMediaStorageDir()).resolves.toBe(
      path.join(process.cwd(), 'storage', 'uploads'),
    );
    await expect(getTusStorageDir()).resolves.toBe(
      path.join(process.cwd(), 'storage', 'tus-uploads'),
    );
  });

  it('honors configured storage path', async () => {
    const configured = path.resolve('test-data', 'pixb');
    process.env.STORAGE_PATH = configured;
    const { getMediaStorageDir, getTusStorageDir } = await import('@/lib/server/storagePaths');

    await expect(getMediaStorageDir()).resolves.toBe(path.join(configured, 'uploads'));
    await expect(getTusStorageDir()).resolves.toBe(path.join(configured, 'tus-uploads'));
  });
});
