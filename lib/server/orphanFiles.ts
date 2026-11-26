import { readdir, rm, stat } from 'fs/promises';
import path from 'path';

import { prisma } from '@/lib/db/prisma';
import { logger } from '@/lib/server/logger';
import { getMediaStorageDir } from '@/lib/server/storagePaths';
import { formatBytes } from '@/lib/server/size';

const DERIVATIVE_DIRS = new Set(['thumbnails', 'covers']);
const MAX_SCAN_FILES = 20_000;

export type OrphanFileKind = 'media' | 'derivative' | 'unknown';

export type OrphanFileItem = {
  id: string;
  relativePath: string;
  filename: string;
  size: number;
  readableSize: string;
  modifiedAt: string;
  kind: OrphanFileKind;
  canReattach: boolean;
  userId: string | null;
  reasonKey: 'mediaMissingRecord' | 'previewMissingRecord' | 'unexpectedLayout';
};

export type OrphanFileScanResult = {
  items: OrphanFileItem[];
  totalSize: number;
  readableTotalSize: string;
  scannedFiles: number;
  truncated: boolean;
};

type ResolvedStoragePath = {
  absolutePath: string;
  relativePath: string;
};

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

function isSubPath(baseDir: string, candidate: string): boolean {
  const relative = path.relative(baseDir, candidate);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function resolveStoragePath(relativePath: string): Promise<ResolvedStoragePath | null> {
  if (!relativePath || path.isAbsolute(relativePath)) return null;
  const baseDir = path.resolve(await getMediaStorageDir());
  const absolutePath = path.resolve(baseDir, relativePath);
  if (!isSubPath(baseDir, absolutePath)) return null;
  return {
    absolutePath,
    relativePath: toPosixPath(path.relative(baseDir, absolutePath)),
  };
}

function getDerivativeSourcePath(filePath: string): string | null {
  const parsed = path.parse(filePath);
  const derivativeDir = path.basename(parsed.dir);
  if (!DERIVATIVE_DIRS.has(derivativeDir) || parsed.ext !== '.webp') return null;
  return path.join(path.dirname(parsed.dir), parsed.name);
}

function getStorageRelativePath(baseDir: string, filePath: string): string {
  return toPosixPath(path.relative(baseDir, filePath));
}

function getPathParts(relativePath: string): string[] {
  return relativePath.split('/').filter(Boolean);
}

function getUserIdFromRelativePath(relativePath: string): bigint | null {
  const [userId] = getPathParts(relativePath);
  if (!userId || !/^\d+$/.test(userId)) return null;
  try {
    return BigInt(userId);
  } catch {
    return null;
  }
}

function classifyPath(relativePath: string): {
  kind: OrphanFileKind;
  reason: OrphanFileItem['reasonKey'];
} {
  const parts = getPathParts(relativePath);
  if (parts.length >= 3 && parts[1] === 'media' && DERIVATIVE_DIRS.has(parts[2])) {
    return {
      kind: 'derivative',
      reason: 'previewMissingRecord',
    };
  }
  if (parts.length >= 3 && parts[1] === 'media') {
    return {
      kind: 'media',
      reason: 'mediaMissingRecord',
    };
  }
  return {
    kind: 'unknown',
    reason: 'unexpectedLayout',
  };
}

async function collectFiles(dir: string, files: string[], limit: number): Promise<boolean> {
  if (files.length >= limit) return true;
  let entries: import('fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return false;
    throw error;
  }

  for (const entry of entries) {
    if (files.length >= limit) return true;
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const truncated = await collectFiles(entryPath, files, limit);
      if (truncated) return true;
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return false;
}

async function getReferencedPaths(baseDir: string): Promise<Set<string>> {
  const [medias, users] = await Promise.all([
    prisma.media.findMany({
      select: { file_data: true },
    }),
    prisma.user.findMany({
      where: { avatar_data: { not: null } },
      select: { avatar_data: true },
    }),
  ]);
  const paths = new Set<string>();

  for (const media of medias) {
    if (!media.file_data) continue;
    const mediaPath = path.resolve(media.file_data);
    if (!isSubPath(baseDir, mediaPath)) continue;
    paths.add(mediaPath);
    const parsed = path.parse(mediaPath);
    paths.add(path.join(parsed.dir, 'thumbnails', `${parsed.name}.webp`));
    paths.add(path.join(parsed.dir, 'covers', `${parsed.name}.webp`));
  }

  for (const user of users) {
    if (!user.avatar_data) continue;
    const avatarPath = path.resolve(user.avatar_data);
    if (!isSubPath(baseDir, avatarPath)) continue;

    paths.add(avatarPath);
    const parsed = path.parse(avatarPath);
    const baseName = parsed.name.endsWith('_large')
      ? parsed.name.slice(0, -'_large'.length)
      : parsed.name;
    paths.add(path.join(parsed.dir, `${baseName}_medium${parsed.ext}`));
    paths.add(path.join(parsed.dir, `${baseName}_small${parsed.ext}`));
  }

  return paths;
}

export async function scanOrphanFiles(): Promise<OrphanFileScanResult> {
  const baseDir = path.resolve(await getMediaStorageDir());
  const files: string[] = [];
  const truncated = await collectFiles(baseDir, files, MAX_SCAN_FILES);
  const referencedPaths = await getReferencedPaths(baseDir);
  const items: OrphanFileItem[] = [];

  for (const filePath of files) {
    const resolvedPath = path.resolve(filePath);
    if (referencedPaths.has(resolvedPath)) continue;

    const sourcePath = getDerivativeSourcePath(resolvedPath);
    if (sourcePath && referencedPaths.has(sourcePath)) continue;

    const stats = await stat(resolvedPath).catch((error: unknown) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return null;
      throw error;
    });
    if (!stats?.isFile()) continue;

    const relativePath = getStorageRelativePath(baseDir, resolvedPath);
    const { kind, reason: reasonKey } = classifyPath(relativePath);
    const userId = getUserIdFromRelativePath(relativePath);

    items.push({
      id: relativePath,
      relativePath,
      filename: path.basename(resolvedPath),
      size: stats.size,
      readableSize: formatBytes(stats.size),
      modifiedAt: stats.mtime.toISOString(),
      kind,
      canReattach: kind === 'media' && Boolean(userId),
      userId: userId?.toString() ?? null,
      reasonKey,
    });
  }

  items.sort((a, b) => b.size - a.size || a.relativePath.localeCompare(b.relativePath));
  const totalSize = items.reduce((sum, item) => sum + item.size, 0);

  return {
    items,
    totalSize,
    readableTotalSize: formatBytes(totalSize),
    scannedFiles: files.length,
    truncated,
  };
}

export async function deleteOrphanFile(relativePath: string): Promise<void> {
  const resolved = await resolveStoragePath(relativePath);
  if (!resolved) {
    logger.warn({ relativePath }, 'Rejected orphan file deletion with invalid storage path');
    throw new Error('Invalid storage path');
  }

  const scan = await scanOrphanFiles();
  const orphan = scan.items.find((item) => item.relativePath === resolved.relativePath);
  if (!orphan) {
    logger.warn(
      { relativePath: resolved.relativePath },
      'Rejected orphan file deletion because file is no longer orphaned',
    );
    throw new Error('File is no longer orphaned');
  }

  await rm(resolved.absolutePath, { force: true });
  logger.info(
    { relativePath: resolved.relativePath, kind: orphan.kind, size: orphan.size },
    'Deleted orphan file',
  );
}
