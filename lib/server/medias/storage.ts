import crypto from 'crypto';
import { spawn } from 'child_process';
import { copyFile, mkdir, open, readdir, rename, rm, stat, unlink } from 'fs/promises';
import path from 'path';
import { fileTypeFromBuffer } from 'file-type';

import { IMAGE_TYPES, MIME_EXTENSION_MAP } from '@/lib/utils/mimeTypes';
import { getMediaStorageDir } from '@/lib/server/storagePaths';
import { assertStorageCapacity } from '@/lib/server/storageStatus';
const THUMB_DIR_NAME = 'thumbnails';
const COVER_DIR_NAME = 'covers';
const THUMB_SIZE = 200;
const COVER_WIDTH = 1280;
const COVER_HEIGHT = 720;

// MIME types that file-type cannot detect (text-based formats) — fall back to declared MIME
const TEXT_BASED_MIMES = new Set([
  'text/plain',
  'text/csv',
  'text/html',
  'text/css',
  'text/javascript',
  'application/json',
  'application/xml',
  'text/xml',
  'text/markdown',
]);

async function validateTextFile(filePath: string): Promise<void> {
  const fh = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(512);
    const { bytesRead } = await fh.read(buffer, 0, 512, 0);
    // Check for null bytes which indicate binary content, not text
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) {
        throw new MagicByteError('File contains binary content but was declared as text');
      }
    }
  } finally {
    await fh.close();
  }
}

export async function validateMagicBytes(filePath: string, declaredMime: string): Promise<void> {
  if (TEXT_BASED_MIMES.has(declaredMime)) {
    await validateTextFile(filePath);
    return;
  }

  const fh = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(4100);
    await fh.read(buffer, 0, 4100, 0);
    const result = await fileTypeFromBuffer(buffer);
    if (result && result.mime !== declaredMime) {
      // Allow close MIME variants (e.g., video/mp4 vs video/quicktime)
      const declaredCategory = declaredMime.split('/')[0];
      const detectedCategory = result.mime.split('/')[0];
      if (declaredCategory !== detectedCategory) {
        throw new MagicByteError(
          `File content (${result.mime}) does not match declared type (${declaredMime})`,
        );
      }
    }
  } finally {
    await fh.close();
  }
}

export class MagicByteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MagicByteError';
  }
}

type SharpModule = typeof import('sharp');
type SharpFactory = SharpModule extends { default: infer T } ? T : SharpModule;
let sharpFactoryPromise: Promise<SharpFactory> | null = null;

async function getSharpFactory(): Promise<SharpFactory> {
  if (!sharpFactoryPromise) {
    sharpFactoryPromise = import('sharp').then(
      (mod) => ('default' in mod ? mod.default : mod) as SharpFactory,
    );
  }
  return sharpFactoryPromise;
}

function safeFilename(name: string): string {
  let safe = name.replace(/[\\/]/g, '_').replace(/\.\./g, '_');
  // Remove null bytes and control characters
  // eslint-disable-next-line no-control-regex
  safe = safe.replace(/[\x00-\x1f\x7f]/g, '');
  return safe;
}

function resolveExtension(filename: string, mimeType?: string | null): string {
  const ext = path.extname(filename || '');
  if (ext) return ext;
  if (mimeType && MIME_EXTENSION_MAP[mimeType]) return MIME_EXTENSION_MAP[mimeType];
  return '';
}

function randomName(): string {
  return crypto.randomBytes(16).toString('hex');
}

async function buildStoragePath(
  userId: bigint,
  baseName: string,
  extension: string,
): Promise<string> {
  const baseDir = await getMediaStorageDir();
  const dir = path.join(baseDir, userId.toString(), 'media');
  const fileName = `${baseName}${extension}`;
  return path.join(dir, fileName);
}

export function getMediaThumbnailPath(filePath: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, THUMB_DIR_NAME, `${parsed.name}.webp`);
}

export function getMediaCoverPath(filePath: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, COVER_DIR_NAME, `${parsed.name}.webp`);
}

export async function ensureMediaThumbnail(
  storagePath: string,
  mimeType: string,
): Promise<string | null> {
  if (!shouldGenerateImageThumbnail(mimeType) && !shouldGenerateVideoThumbnail(mimeType)) {
    return null;
  }

  const thumbPath = getMediaThumbnailPath(storagePath);
  try {
    const info = await stat(thumbPath);
    if (info.size > 8) return thumbPath;
  } catch {
    // Thumbnail missing, generate on demand.
  }

  await acquireThumbSlot();
  try {
    await createThumbnailForMedia(storagePath, mimeType, thumbPath);
    return thumbPath;
  } finally {
    releaseThumbSlot();
  }
}

export async function ensureMediaCover(
  storagePath: string,
  mimeType: string,
): Promise<string | null> {
  if (!shouldGenerateVideoThumbnail(mimeType)) {
    return null;
  }

  const coverPath = getMediaCoverPath(storagePath);
  try {
    const info = await stat(coverPath);
    if (info.size > 8) return coverPath;
  } catch {
    // Cover missing, generate on demand.
  }

  await acquireThumbSlot();
  try {
    await createVideoPreviews(storagePath);
    return coverPath;
  } finally {
    releaseThumbSlot();
  }
}

export async function deleteMediaFiles(filePath?: string | null): Promise<void> {
  if (!filePath) return;
  const thumbPath = getMediaThumbnailPath(filePath);
  const coverPath = getMediaCoverPath(filePath);

  await Promise.all([
    rm(filePath, { force: true }),
    rm(thumbPath, { force: true }),
    rm(coverPath, { force: true }),
  ]);

  const mediaDir = path.dirname(filePath);
  const thumbDir = path.join(mediaDir, THUMB_DIR_NAME);
  const coverDir = path.join(mediaDir, COVER_DIR_NAME);
  const userDir = path.dirname(mediaDir);
  const baseDir = path.resolve(await getMediaStorageDir());

  const removeIfEmpty = async (dir: string) => {
    try {
      const entries = await readdir(dir);
      if (entries.length === 0) {
        await rm(dir, { force: true });
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  };

  await removeIfEmpty(thumbDir);
  await removeIfEmpty(coverDir);
  const mediaRemoved = await removeIfEmpty(mediaDir);
  if (mediaRemoved) {
    const resolvedUserDir = path.resolve(userDir);
    if (resolvedUserDir.startsWith(baseDir)) {
      await removeIfEmpty(resolvedUserDir);
    }
  }
}

const MAX_IMAGE_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_CONCURRENT_THUMBS = 4;
let activeThumbCount = 0;
const thumbQueue: (() => void)[] = [];

function acquireThumbSlot(): Promise<void> {
  if (activeThumbCount < MAX_CONCURRENT_THUMBS) {
    activeThumbCount++;
    return Promise.resolve();
  }
  return new Promise((resolve) => thumbQueue.push(resolve));
}

function releaseThumbSlot(): void {
  const next = thumbQueue.shift();
  if (next) {
    next();
  } else {
    activeThumbCount--;
  }
}

async function createImageThumbnail(sourcePath: string, targetPath: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const sharp = await getSharpFactory();
  const image = sharp(sourcePath);
  const metadata = await image.metadata();
  if (metadata.size && metadata.size > MAX_IMAGE_BYTES) {
    throw new Error('Image file too large for thumbnail generation');
  }
  if ((metadata.width && metadata.width > 10000) || (metadata.height && metadata.height > 10000)) {
    throw new Error('Image too large');
  }
  await image.resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' }).toFormat('webp').toFile(targetPath);
}

const VIDEO_THUMB_TIMEOUT_MS = 45_000;
let cachedFfmpegBinaryPath: string | null | undefined;

async function fileExists(candidatePath: string): Promise<boolean> {
  try {
    await stat(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveFfmpegBinaryPath(): Promise<string | null> {
  if (cachedFfmpegBinaryPath !== undefined) {
    return cachedFfmpegBinaryPath;
  }

  // Production builds use a system executable or the path configured by the operator.
  const localModuleBinary =
    process.env.NODE_ENV !== 'production'
      ? path.join(
          /*turbopackIgnore: true*/ process.cwd(),
          'node_modules',
          'ffmpeg-static',
          process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
        )
      : undefined;
  const candidates = [
    process.env.FFMPEG_PATH,
    process.env.FFMPEG_BIN,
    localModuleBinary,
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      cachedFfmpegBinaryPath = candidate;
      return candidate;
    }
  }

  cachedFfmpegBinaryPath = null;
  return null;
}

async function runFfmpeg(args: string[], _context: string): Promise<void> {
  const resolvedFfmpegPath = await resolveFfmpegBinaryPath();
  if (!resolvedFfmpegPath) {
    throw new Error('ffmpeg binary is not available; set FFMPEG_PATH or install ffmpeg');
  }

  return new Promise((resolve, reject) => {
    let stderr = '';
    const proc = spawn(resolvedFfmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = (stderr + chunk.toString()).slice(-4096);
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('ffmpeg timed out while generating thumbnail'));
    }, VIDEO_THUMB_TIMEOUT_MS);

    proc.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        // Seeking past the last frame can exit successfully with only a WebP header.
        // Treat that as a failed extraction so the caller tries the first frame.
        void stat(args.at(-1)!).then((info) => {
          if (info.size > 8) resolve();
          else reject(new Error('ffmpeg produced no preview frame'));
        }, reject);
        return;
      }
      const message = stderr.trim();
      const tail = message ? `: ${message.slice(-400)}` : '';
      reject(new Error(`ffmpeg exited with code ${code}${tail}`));
    });
  });
}

// Coalesce upload-background work and on-demand thumbnail/cover requests.
const videoPreviewJobs = new Map<string, Promise<void>>();
const VIDEO_FRAME_EDGE = 2560;
// Square pixels preserve anamorphic display proportions before Sharp crops.
// Bound both dimensions of the intermediate image, including rotated videos.
const VIDEO_FRAME_FILTER = `scale=w='max(1,min(iw*sar,min(${VIDEO_FRAME_EDGE},${VIDEO_FRAME_EDGE}*dar)))':h='max(1,min(ih,min(${VIDEO_FRAME_EDGE},${VIDEO_FRAME_EDGE}/dar)))',setsar=1`;

async function writeVideoPreviews(sourcePath: string): Promise<void> {
  const thumbPath = getMediaThumbnailPath(sourcePath);
  const coverPath = getMediaCoverPath(sourcePath);
  await mkdir(path.dirname(thumbPath), { recursive: true });
  await mkdir(path.dirname(coverPath), { recursive: true });
  const framePath = path.join(path.dirname(coverPath), `.frame-${randomName()}.png`);
  const extract = (timestamp: string) =>
    runFfmpeg(
      [
        '-nostdin',
        '-v',
        'error',
        '-y',
        '-protocol_whitelist',
        'file',
        '-ss',
        timestamp,
        '-i',
        sourcePath,
        '-map',
        '0:v:0',
        '-an',
        '-sn',
        '-dn',
        '-frames:v',
        '1',
        '-vf',
        VIDEO_FRAME_FILTER,
        '-c:v',
        'png',
        framePath,
      ],
      'video-frame',
    );
  try {
    try {
      await extract('00:00:01.000');
    } catch {
      // Seeking beyond a short clip can succeed without producing a frame.
      await rm(framePath, { force: true });
      await extract('00:00:00.000');
    }
    const sharp = await getSharpFactory();
    await sharp(framePath)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', position: 'centre' })
      .toFormat('webp', { quality: 70 })
      .toFile(thumbPath);
    await sharp(framePath)
      .resize(COVER_WIDTH, COVER_HEIGHT, { fit: 'cover', position: 'centre' })
      .toFormat('webp', { quality: 80 })
      .toFile(coverPath);
  } finally {
    await rm(framePath, { force: true });
  }
}

async function createVideoPreviews(sourcePath: string): Promise<void> {
  const key = path.resolve(sourcePath);
  const existing = videoPreviewJobs.get(key);
  if (existing) return existing;
  const job = writeVideoPreviews(sourcePath);
  videoPreviewJobs.set(key, job);
  try {
    await job;
  } finally {
    videoPreviewJobs.delete(key);
  }
}

function shouldGenerateImageThumbnail(mimeType: string): boolean {
  return IMAGE_TYPES.includes(mimeType) || mimeType.startsWith('image/');
}

function shouldGenerateVideoThumbnail(mimeType: string): boolean {
  return mimeType.startsWith('video/');
}

async function createThumbnailForMedia(
  storagePath: string,
  mimeType: string,
  thumbPath: string,
): Promise<void> {
  if (shouldGenerateImageThumbnail(mimeType)) {
    await createImageThumbnail(storagePath, thumbPath);
    return;
  }
  if (shouldGenerateVideoThumbnail(mimeType)) {
    await createVideoPreviews(storagePath);
  }
}

export type StoredMediaFile = {
  path: string;
  size: number;
  mimeType: string;
  filename: string;
  extension: string;
};

async function moveFile(sourcePath: string, destinationPath: string): Promise<void> {
  try {
    await rename(sourcePath, destinationPath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'EXDEV') throw error;
    await copyFile(sourcePath, destinationPath);
    await unlink(sourcePath);
  }
}

export async function storeMediaFileFromPath(
  sourcePath: string,
  filename: string,
  mimeType: string,
  userId: bigint,
): Promise<StoredMediaFile> {
  const rawName = safeFilename(filename || 'upload');
  const resolvedMimeType = mimeType || 'application/octet-stream';
  const extension = resolveExtension(rawName, resolvedMimeType);
  const storagePath = await buildStoragePath(userId, randomName(), extension);

  await mkdir(path.dirname(storagePath), { recursive: true });
  let stats;
  try {
    await validateMagicBytes(sourcePath, resolvedMimeType);
    await moveFile(sourcePath, storagePath);
    stats = await stat(storagePath);
  } catch (error) {
    await Promise.resolve(rm(storagePath, { force: true })).catch(() => undefined);
    throw error;
  }
  const finalName = rawName || `upload${extension}`;

  return {
    path: storagePath,
    size: stats.size,
    mimeType: resolvedMimeType,
    filename: finalName,
    extension,
  };
}

export async function generateMediaPreview(storagePath: string, mimeType: string): Promise<void> {
  // Preview failure is non-fatal after original-file finalization.
  await assertStorageCapacity(path.dirname(storagePath));
  if (shouldGenerateVideoThumbnail(mimeType)) {
    await createVideoPreviews(storagePath);
    return;
  }

  if (shouldGenerateImageThumbnail(mimeType)) {
    const thumbPath = getMediaThumbnailPath(storagePath);
    await createThumbnailForMedia(storagePath, mimeType, thumbPath);
  }
}
