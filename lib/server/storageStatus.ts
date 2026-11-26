import fs from 'fs/promises';
import path from 'path';
import crypto from 'node:crypto';
import { getMediaStorageDir, getTusStorageDir } from '@/lib/server/storagePaths';

export const STORAGE_RESERVE_BYTES = 128n * 1024n * 1024n;
export class StorageError extends Error {
  constructor(
    public readonly code: 'storageFull' | 'storageUnavailable',
    options?: ErrorOptions,
  ) {
    super(
      code === 'storageFull'
        ? 'Not enough storage space. Free some space and retry.'
        : 'File storage is unavailable. Check its mount and write permissions.',
      options,
    );
    this.name = 'StorageError';
  }
  get status() {
    return this.code === 'storageFull' ? 507 : 503;
  }
}
export function storageFailure(error: unknown): StorageError | null {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    if (current instanceof StorageError) return current;
    const item = current as { code?: string; cause?: unknown };
    if (['ENOSPC', 'EDQUOT'].includes(item.code || ''))
      return new StorageError('storageFull', { cause: error });
    if (['EACCES', 'EPERM', 'EROFS', 'EIO', 'ENOTDIR', 'ESTALE'].includes(item.code || ''))
      return new StorageError('storageUnavailable', { cause: error });
    current = item.cause;
  }
  return null;
}
export async function assertStorageCapacity(
  directory: string,
  bytes: number | bigint = 0,
): Promise<void> {
  try {
    if (typeof bytes === 'number' && (!Number.isSafeInteger(bytes) || bytes < 0))
      throw new Error('Invalid storage size');
    const needed = BigInt(bytes);
    if (needed < 0n) throw new Error('Invalid storage size');
    const info = await fs.statfs(directory, { bigint: true });
    if (info.bavail * info.bsize < needed + STORAGE_RESERVE_BYTES)
      throw new StorageError('storageFull');
  } catch (error) {
    throw storageFailure(error) || new StorageError('storageUnavailable', { cause: error });
  }
}
export async function assertStorageMove(
  source: string,
  destination: string,
  bytes: number,
): Promise<void> {
  try {
    const [from, to] = await Promise.all([fs.stat(source), fs.stat(destination)]);
    await assertStorageCapacity(destination, from.dev === to.dev ? 0 : bytes);
  } catch (error) {
    throw storageFailure(error) || new StorageError('storageUnavailable', { cause: error });
  }
}
export async function ensureStorageReady(): Promise<void> {
  for (const directory of [await getMediaStorageDir(), await getTusStorageDir()]) {
    const probe = path.join(directory, `.pixb-storage-probe-${crypto.randomUUID()}`);
    const moved = `${probe}.moved`;
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      await fs.mkdir(directory, { recursive: true });
      handle = await fs.open(probe, 'wx', 0o600);
      await handle.writeFile('PixB storage check');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(probe, moved);
      await fs.unlink(moved);
    } catch (error) {
      throw storageFailure(error) || new StorageError('storageUnavailable', { cause: error });
    } finally {
      await handle?.close().catch(() => {});
      await Promise.all([probe, moved].map((file) => fs.rm(file, { force: true }).catch(() => {})));
    }
  }
}
