import { copyFile, unlink } from 'node:fs/promises';
import crypto from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ERRORS, Server, type ServerOptions } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { prisma } from '@/lib/db/prisma';
import { getAuthFromCookieHeader } from '@/lib/server/auth';
import { getInstanceSettings } from '@/lib/server/instance';
import { getTusStorageDir } from '@/lib/server/storagePaths';
import { getTusUploadPath, ensureTusUploadDir } from '@/lib/server/tusStorage';
import { createMediaFromPath } from '@/lib/server/medias/create';
import { resolveUploadMimeType } from '@/lib/utils/mimeTypes';
import { checkUserQuotaSnapshot } from '@/lib/server/medias/quota';
import { assertStorageCapacity, storageFailure } from '@/lib/server/storageStatus';
type TusRequest = Parameters<NonNullable<ServerOptions['onUploadCreate']>>[0];
// FileStore's default writer replaces filesystem errors with a generic error.
// Preserve the actual cause so disk-full/permission failures remain actionable,
// retaining the received prefix for normal TUS HEAD/resume behavior.
class StorageAwareFileStore extends FileStore {
  async write(readable: Parameters<FileStore['write']>[0], id: string, offset: number) {
    let received = 0,
      checked = 0;
    const directory = await getTusStorageDir();
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (checked === 0 || received - checked >= 1024 * 1024) {
          checked = received;
          assertStorageCapacity(directory, Math.max(chunk.length, 1024 * 1024)).then(
            () => callback(null, chunk),
            (error: Error) => callback(error),
          );
        } else callback(null, chunk);
      },
    });
    try {
      await pipeline(
        readable,
        counter,
        createWriteStream(await getTusUploadPath(id), { flags: 'r+', start: offset }),
      );
      return offset + received;
    } catch (error) {
      throw storageFailure(error) || error;
    }
  }
}
let instance: Server | null = null;
async function owner(req: TusRequest) {
  req.signal?.throwIfAborted();
  const auth = await getAuthFromCookieHeader(req.headers.get('cookie'));
  req.signal?.throwIfAborted();
  if (!auth?.user || !auth.session) throw { status_code: 401, body: 'Unauthorized' };
  return auth.user;
}
type TusUpload = Parameters<NonNullable<ServerOptions['onUploadFinish']>>[1];
async function finalizeUpload(req: TusRequest, upload: TusUpload) {
  const user = await owner(req);
  if (upload.metadata?.pixb_owner !== user.id.toString())
    throw { status_code: 404, body: 'Upload not found' };
  const existing = await prisma.media.findUnique({ where: { upload_id: upload.id } });
  if (existing) {
    if (existing.user_id !== user.id) throw { status_code: 404, body: 'Upload not found' };
    return { headers: { 'X-Pixb-File': existing.id.toString() } };
  }
  // Keep the tus source until stale-upload cleanup so a lost final response can resume safely.
  const staging = await getTusUploadPath(`finalize-${crypto.randomUUID()}`);
  try {
    await assertStorageCapacity(await getTusStorageDir(), upload.size || 0);
    req.signal?.throwIfAborted();
    await copyFile(await getTusUploadPath(upload.id), staging);
    req.signal?.throwIfAborted();
    const result = await createMediaFromPath(
      user,
      staging,
      String(upload.metadata?.filename || 'upload'),
      String(upload.metadata?.filetype || 'application/octet-stream'),
      {
        isShared: false,
        collectionId: upload.metadata?.collection ? BigInt(upload.metadata.collection) : undefined,
        uploadId: upload.id,
      },
    );
    if ('error' in result) throw { status_code: result.error.status, body: result.error.message };
    return { headers: { 'X-Pixb-File': result.data.id.toString() } };
  } finally {
    await unlink(staging).catch(() => {});
  }
}
export async function getTusServer(): Promise<Server> {
  if (instance) return instance;
  await ensureTusUploadDir();
  const store = new StorageAwareFileStore({ directory: await getTusStorageDir() });
  instance = new Server({
    path: '/files',
    datastore: store,
    allowedCredentials: true,
    respectForwardedHeaders: true,
    onResponseError: async (_req, error) => {
      let failure = storageFailure(error);
      // FileStore metadata creation can conceal the original filesystem error.
      // Recheck capacity for this specific write error; never turn unrelated
      // server failures into a misleading disk-full response.
      if (!failure && 'body' in error && error.body === ERRORS.FILE_WRITE_ERROR.body) {
        try {
          await assertStorageCapacity(await getTusStorageDir());
        } catch (cause) {
          failure = storageFailure(cause);
        }
        if (!failure) return { status_code: 503, body: 'storageUnavailable' };
      }
      return failure ? { status_code: failure.status, body: failure.code } : undefined;
    },
    maxSize: async () => {
      const s = await getInstanceSettings();
      return s.maxUploadSize > 0 ? s.maxUploadSize * 1024 * 1024 : 0;
    },
    generateUrl: (_req, { proto, host, path, id }) => `${proto}://${host}${path}/${id}`,
    onIncomingRequest: async (req, id) => {
      if (req.method === 'OPTIONS') return;
      const user = await owner(req);
      if (req.method !== 'POST') {
        const upload = await store.getUpload(id);
        if (upload.metadata?.pixb_owner !== user.id.toString())
          throw { status_code: 404, body: 'Upload not found' };
        // A previous final-copy failure must not let HEAD report a completed
        // upload before its library entry exists. Retry finalization first.
        if (req.method === 'HEAD' && upload.size && upload.offset === upload.size)
          await finalizeUpload(req, upload);
      }
      if (req.method === 'PATCH') {
        const size = Number(req.headers.get('content-length') || 0);
        if (!Number.isSafeInteger(size) || size < 0)
          throw { status_code: 400, body: 'Invalid file size' };
        await assertStorageCapacity(await getTusStorageDir(), size);
      }
      req.signal?.throwIfAborted();
    },
    onUploadCreate: async (req, upload) => {
      const user = await owner(req),
        settings = await getInstanceSettings();
      if (!upload.size || !Number.isSafeInteger(upload.size))
        throw { status_code: 422, body: 'Invalid file size' };
      if (settings.maxUploadSize > 0 && upload.size > settings.maxUploadSize * 1024 * 1024)
        throw { status_code: 413, body: 'File exceeds upload limit' };
      const name = String(upload.metadata?.filename || upload.metadata?.name || 'upload');
      const mime = resolveUploadMimeType(name, upload.metadata?.filetype || upload.metadata?.type);
      const issue = checkUserQuotaSnapshot(user, upload.size);
      if (issue) throw { status_code: issue.status, body: issue.error.message };
      await assertStorageCapacity(await getTusStorageDir(), BigInt(upload.size) * 2n);
      const collection = upload.metadata?.collection;
      if (collection) {
        if (
          !/^\d+$/.test(collection) ||
          !(await prisma.collection.findFirst({
            where: { id: BigInt(collection), user_id: user.id },
          }))
        )
          throw { status_code: 404, body: 'Collection not found' };
      }
      req.signal?.throwIfAborted();
      return {
        metadata: {
          filename: name,
          filetype: mime,
          pixb_owner: user.id.toString(),
          ...(collection ? { collection } : {}),
        },
      };
    },
    onUploadFinish: finalizeUpload,
  });
  return instance;
}
