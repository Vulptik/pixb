import { stat } from 'node:fs/promises';
import type { Media } from '@prisma/client';
import { getInstanceSettings } from '@/lib/server/instance';
import {
  storeMediaFileFromPath,
  deleteMediaFiles,
  generateMediaPreview,
  MagicByteError,
} from '@/lib/server/medias/storage';
import { finalizeWithUserQuota } from '@/lib/server/medias/quota';
import { generateUniqueMediaUid } from '@/lib/server/medias/uid';
import { enqueuePreviewJob } from '@/lib/server/medias/previews';
import { assertStorageMove } from '@/lib/server/storageStatus';
import { getMediaStorageDir } from '@/lib/server/storagePaths';
type Owner = { id: bigint; quota: number; cached_quota_used?: bigint | number | null };
type Options = {
  isShared?: boolean;
  validateMaxUploadSize?: boolean;
  collectionId?: bigint;
  uploadId?: string;
  filename?: string | null;
  knownSize?: number;
};
export type MediaCreateResult = { data: Media } | { error: { message: string; status: number } };
async function validate(size: number): Promise<MediaCreateResult | null> {
  const settings = await getInstanceSettings();
  if (!Number.isSafeInteger(size) || size <= 0)
    return { error: { message: 'Invalid file size', status: 422 } };
  if (settings.maxUploadSize > 0 && size > settings.maxUploadSize * 1024 * 1024)
    return { error: { message: 'File exceeds upload limit', status: 413 } };
  return null;
}
async function finish(
  owner: Owner,
  stored: { path: string; filename: string; mimeType: string; size: number },
  options: Options,
): Promise<MediaCreateResult> {
  try {
    const uid = await generateUniqueMediaUid();
    const result = await finalizeWithUserQuota(owner, stored.size, async (tx) => {
      if (
        options.collectionId &&
        !(await tx.collection.findFirst({ where: { id: options.collectionId, user_id: owner.id } }))
      )
        throw new Error('Collection not found');
      return tx.media.create({
        data: {
          uid,
          user_id: owner.id,
          filename: stored.filename,
          mime_type: stored.mimeType,
          size: stored.size,
          file_data: stored.path,
          is_shared: options.isShared ?? false,
          upload_id: options.uploadId,
          collections: options.collectionId
            ? { create: { collection_id: options.collectionId } }
            : undefined,
        },
      });
    });
    if (!result.ok) {
      await deleteMediaFiles(stored.path);
      return { error: { message: result.message, status: result.status } };
    }
    enqueuePreviewJob(() => generateMediaPreview(stored.path, stored.mimeType), {
      mediaId: result.data.id.toString(),
    });
    return { data: result.data };
  } catch (e) {
    await deleteMediaFiles(stored.path).catch(() => {});
    if (e instanceof Error && e.message === 'Collection not found')
      return { error: { message: e.message, status: 404 } };
    throw e;
  }
}
export async function createMediaFromPath(
  owner: Owner,
  source: string,
  name: string,
  mime: string,
  options: Options = {},
): Promise<MediaCreateResult> {
  const info = await stat(source).catch(() => null);
  if (!info) return { error: { message: 'Upload not found', status: 404 } };
  const issue = await validate(info.size);
  if (issue) return issue;
  try {
    await assertStorageMove(source, await getMediaStorageDir(), info.size);
    return await finish(owner, await storeMediaFileFromPath(source, name, mime, owner.id), options);
  } catch (e) {
    if (e instanceof MagicByteError) return { error: { message: e.message, status: 422 } };
    throw e;
  }
}
