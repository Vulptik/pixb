import { unlink } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import {
  libraryAuth,
  libraryFile,
  libraryId,
  ownedCollection,
  LibraryError,
} from '@/lib/server/library';
import { libraryRoute } from '@/lib/server/libraryRoute';
import { createMediaFromPath } from '@/lib/server/medias/create';
import { getInstanceSettings } from '@/lib/server/instance';
import { parseMultipartUpload, MultipartUploadError } from '@/lib/server/uploads/multipart';
import { getAppUrl } from '@/lib/server/appUrl';
import { checkRateLimit } from '@/lib/server/rateLimit';
export const POST = libraryRoute(async (request) => {
  const user = await libraryAuth(request, 'write');
  if (!checkRateLimit(`upload:${user.id}`, { maxAttempts: 30, windowMs: 15 * 60 * 1000 }))
    throw new LibraryError('rateLimited', 429);
  if (!request.headers.get('content-type')?.includes('multipart/form-data'))
    throw new LibraryError('invalidInput', 422);
  const settings = await getInstanceSettings();
  let form;
  try {
    form = await parseMultipartUpload(request, {
      maxFileBytes: settings.maxUploadSize > 0 ? settings.maxUploadSize * 1024 * 1024 : 0,
    });
  } catch (e) {
    if (e instanceof MultipartUploadError)
      throw new LibraryError(e.status === 413 ? 'fileTooLarge' : 'invalidInput', e.status);
    throw e;
  }
  if (!form.file) throw new LibraryError('invalidInput', 422);
  const file = form.file;
  try {
    const collectionValue = form.fields.get('collection');
    const collectionId = collectionValue ? libraryId(collectionValue) : undefined;
    if (collectionId) await ownedCollection(user.id, collectionId);
    const result = await createMediaFromPath(user, file.path, file.filename, file.mimeType, {
      isShared: form.fields.get('share') === 'true',
      validateMaxUploadSize: true,
      collectionId,
    });
    if ('error' in result)
      throw new LibraryError(
        result.error.message === 'Quota exceeded'
          ? 'quotaExceeded'
          : result.error.status === 413
            ? 'fileTooLarge'
            : 'uploadFailed',
        result.error.status,
      );
    const data = libraryFile(
      { ...result.data, collections: collectionId ? [{ collection_id: collectionId }] : [] },
      await getAppUrl(request),
    );
    return NextResponse.json(
      { file: data, shareUrl: data.shared ? data.links.share : null, rawUrl: data.links.original },
      { status: 201 },
    );
  } finally {
    await unlink(file.path).catch(() => {});
  }
});
