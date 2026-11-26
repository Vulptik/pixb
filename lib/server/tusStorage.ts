import path from 'path';
import { lstat, mkdir, readdir, rm } from 'fs/promises';
import type { Stats } from 'fs';

import { getTusStorageDir } from '@/lib/server/storagePaths';
import { logger } from '@/lib/server/logger';
import { withTusCleanup } from '@/lib/server/tusActivity';

export async function ensureTusUploadDir(): Promise<void> {
  const dir = await getTusStorageDir();
  await mkdir(dir, { recursive: true });
}

const VALID_TUS_ID = /^[a-zA-Z0-9_-]+$/;

function validateTusId(id: string): void {
  if (!VALID_TUS_ID.test(id)) {
    throw new Error('Invalid TUS upload ID');
  }
}

export async function getTusUploadPath(id: string): Promise<string> {
  validateTusId(id);
  const dir = await getTusStorageDir();
  return path.join(dir, id);
}

const TUS_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

async function inspect(filePath: string): Promise<Stats | null> {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

export async function cleanupStaleTusUploads(): Promise<number | null> {
  return withTusCleanup(cleanupAbandonedUploads);
}

async function cleanupAbandonedUploads(assertLock: () => void): Promise<number> {
  assertLock();
  const dir = await getTusStorageDir();
  let entries: string[];
  try {
    const directory = await inspect(dir);
    if (!directory) return 0;
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw new Error('Upload storage must be a real directory.');
    entries = await readdir(dir);
  } catch (error) {
    if (missing(error)) return 0;
    logger.warn(
      { code: (error as NodeJS.ErrnoException)?.code },
      'Cannot read stale upload storage',
    );
    throw new Error('Stale upload cleanup could not read storage.', { cause: error });
  }

  const now = Date.now();
  let cleaned = 0;

  const ids = new Set(entries.map((entry) => entry.replace(/\.json$/, '')));
  for (const id of ids) {
    assertLock();
    if (!VALID_TUS_ID.test(id)) continue;
    const filePath = path.join(dir, id);
    const metaPath = `${filePath}.json`;
    try {
      const [data, meta] = await Promise.all([inspect(filePath), inspect(metaPath)]);
      const files = [data, meta].filter((item): item is Stats => item !== null);
      if (
        !files.length ||
        files.some((item) => !item.isFile() || item.isSymbolicLink()) ||
        files.some((item) => now - item.mtimeMs <= TUS_MAX_AGE_MS)
      )
        continue;

      // An upload may have resumed while we were scanning. Check both identities
      // and timestamps again before deleting an abandoned pair or staging file.
      const current = await Promise.all([inspect(filePath), inspect(metaPath)]);
      if (
        [data, meta].some((previous, index) => {
          const item = current[index];
          return previous
            ? !item ||
                !item.isFile() ||
                item.isSymbolicLink() ||
                item.ino !== previous.ino ||
                item.dev !== previous.dev ||
                item.size !== previous.size ||
                item.mtimeMs !== previous.mtimeMs
            : item !== null;
        })
      )
        continue;
      assertLock();
      if (data) await rm(filePath, { force: true });
      assertLock();
      if (meta) await rm(metaPath, { force: true });
      cleaned++;
    } catch (error) {
      if (missing(error)) continue;
      logger.warn(
        { code: (error as NodeJS.ErrnoException)?.code },
        'Cannot clean stale upload files',
      );
      throw new Error('Stale upload cleanup could not remove temporary files.', { cause: error });
    }
  }

  if (cleaned > 0) {
    logger.info({ cleaned }, 'Cleaned up stale TUS uploads');
  }
  return cleaned;
}
