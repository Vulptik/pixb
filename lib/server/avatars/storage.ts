import { mkdir, rm } from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

import { logger } from '@/lib/server/logger';

import { getMediaStorageDir } from '@/lib/server/storagePaths';

// Avatar size configurations
const AVATAR_SIZES = {
  small: 64,
  medium: 128,
  large: 256,
} as const;

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

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

function resolveExtension(filename: string, mimeType?: string | null) {
  const ext = path.extname(filename || '');
  if (ext) return ext;
  if (mimeType && MIME_EXTENSION_MAP[mimeType]) return MIME_EXTENSION_MAP[mimeType];
  return '.png';
}

function randomName(): string {
  return crypto.randomBytes(16).toString('hex');
}

async function buildAvatarPath(
  userId: string | number | bigint,
  filename: string,
  extension: string,
  variant?: 'small' | 'medium' | 'large',
): Promise<string> {
  const baseDir = await getMediaStorageDir();
  const dir = path.join(baseDir, userId.toString(), 'profile_picture');
  const suffix = variant ? `_${variant}` : '';
  const fileName = `${filename}${suffix}${extension}`;
  return path.join(dir, fileName);
}

/**
 * Process and save avatar image in multiple sizes
 */
async function processAndSaveAvatar(
  imageBuffer: Buffer,
  userId: bigint,
  baseName: string,
  extension: string,
): Promise<string> {
  const baseDir = await getMediaStorageDir();
  const dir = path.join(baseDir, userId.toString(), 'profile_picture');
  await mkdir(dir, { recursive: true });

  // Determine output format - convert to WebP for better compression, except GIF
  const isGif = extension === '.gif';
  const outputExtension = isGif ? '.gif' : '.webp';
  const sharp = await getSharpFactory();

  // Save large (original size, max 256x256)
  const largePath = await buildAvatarPath(userId, baseName, outputExtension, 'large');
  const largeImage = sharp(imageBuffer).resize(AVATAR_SIZES.large, AVATAR_SIZES.large, {
    fit: 'cover',
    position: 'center',
  });
  if (isGif) {
    await largeImage.gif().toFile(largePath);
  } else {
    await largeImage.webp({ quality: 90 }).toFile(largePath);
  }

  // Save medium (128x128)
  const mediumPath = await buildAvatarPath(userId, baseName, outputExtension, 'medium');
  const mediumImage = sharp(imageBuffer).resize(AVATAR_SIZES.medium, AVATAR_SIZES.medium, {
    fit: 'cover',
    position: 'center',
  });
  if (isGif) {
    await mediumImage.gif().toFile(mediumPath);
  } else {
    await mediumImage.webp({ quality: 85 }).toFile(mediumPath);
  }

  // Save small (64x64)
  const smallPath = await buildAvatarPath(userId, baseName, outputExtension, 'small');
  const smallImage = sharp(imageBuffer).resize(AVATAR_SIZES.small, AVATAR_SIZES.small, {
    fit: 'cover',
    position: 'center',
  });
  if (isGif) {
    await smallImage.gif().toFile(smallPath);
  } else {
    await smallImage.webp({ quality: 80 }).toFile(smallPath);
  }

  // Return the large variant path as the main reference
  return largePath;
}

export type StoredAvatarFile = {
  path: string;
  mimeType: string;
  filename: string;
};

export async function storeAvatarFile(file: File, userId: bigint): Promise<StoredAvatarFile> {
  const mimeType = file.type || 'image/png';
  const extension = resolveExtension(file.name || '', mimeType);
  const baseName = randomName();
  const buffer = Buffer.from(await file.arrayBuffer());

  // Process and save in multiple sizes
  const storagePath = await processAndSaveAvatar(buffer, userId, baseName, extension);

  return {
    path: storagePath,
    mimeType: extension === '.gif' ? 'image/gif' : 'image/webp',
    filename: path.basename(storagePath),
  };
}

export async function storeAvatarDataUrl(
  dataUrl: string,
  userId: bigint,
): Promise<StoredAvatarFile> {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid data URL');
  }

  const mimeType = match[1];
  const data = match[2];
  const extension = resolveExtension('', mimeType);
  const baseName = randomName();
  const buffer = Buffer.from(data, 'base64');

  // Process and save in multiple sizes
  const storagePath = await processAndSaveAvatar(buffer, userId, baseName, extension);

  return {
    path: storagePath,
    mimeType: extension === '.gif' ? 'image/gif' : 'image/webp',
    filename: path.basename(storagePath),
  };
}

/**
 * Delete all avatar files for a user
 */
export async function deleteAllUserAvatars(userId: bigint): Promise<void> {
  try {
    const baseDir = await getMediaStorageDir();
    const avatarDir = path.join(baseDir, userId.toString(), 'profile_picture');

    // Check if directory exists and delete it with all contents
    await rm(avatarDir, { recursive: true, force: true });
  } catch (error) {
    // Log error but don't throw - it's okay if the directory doesn't exist
    logger.error({ error, userId: userId.toString() }, 'Failed to delete avatars for user');
  }
}
