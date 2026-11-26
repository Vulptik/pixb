import crypto from 'crypto';
import path from 'path';
import { createWriteStream } from 'fs';
import { mkdir, rm } from 'fs/promises';
import { Readable } from 'stream';
import { finished } from 'stream/promises';

import { getTusStorageDir } from '@/lib/server/storagePaths';
import { assertStorageCapacity } from '@/lib/server/storageStatus';

const HEADER_SEPARATOR = Buffer.from('\r\n\r\n');
const FIELD_SIZE_LIMIT = 64 * 1024;

export class MultipartUploadError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'MultipartUploadError';
  }
}

export type ParsedMultipartUpload = {
  fields: Map<string, string>;
  file: {
    path: string;
    filename: string;
    mimeType: string;
    size: number;
    cleanup: () => Promise<void>;
  } | null;
};

function getBoundary(contentType: string): string | null {
  const match = /(?:^|;\s*)boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  return match?.[1] || match?.[2] || null;
}

function parseHeaderBlock(block: Buffer): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of block.toString('latin1').split('\r\n')) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    headers.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim());
  }
  return headers;
}

function parseContentDisposition(value: string | undefined): {
  name: string | null;
  filename: string | null;
} {
  if (!value) return { name: null, filename: null };
  const params = new Map<string, string>();
  for (const part of value.split(';').slice(1)) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim().toLowerCase();
    const rawValue = part.slice(index + 1).trim();
    params.set(key, rawValue.replace(/^"|"$/g, ''));
  }
  return {
    name: params.get('name') || null,
    filename: params.get('filename') || params.get('filename*') || null,
  };
}

async function writeOrDrain(stream: ReturnType<typeof createWriteStream>, chunk: Buffer) {
  if (stream.errored) throw stream.errored;
  await new Promise<void>((resolve, reject) =>
    stream.write(chunk, (error) => (error ? reject(stream.errored || error) : resolve())),
  );
}

async function closeFileStream(stream: ReturnType<typeof createWriteStream> | null): Promise<void> {
  if (!stream) return;
  const complete = finished(stream, { cleanup: true });
  stream.end();
  await complete;
}

export async function parseMultipartUpload(
  request: Request,
  options: { maxFileBytes?: number } = {},
): Promise<ParsedMultipartUpload> {
  const boundaryValue = getBoundary(request.headers.get('content-type') || '');
  if (!boundaryValue) throw new MultipartUploadError('Invalid multipart request', 400);
  if (!request.body) throw new MultipartUploadError('Missing request body', 400);

  const boundary = Buffer.from(`--${boundaryValue}`);
  const partBoundary = Buffer.from(`\r\n--${boundaryValue}`);
  const tailSize = partBoundary.length + 4;
  const tempDir = await getTusStorageDir();
  await mkdir(tempDir, { recursive: true });
  const declared = Number(request.headers.get('content-length') || 0);
  await assertStorageCapacity(
    tempDir,
    Number.isSafeInteger(declared) && declared > 0 ? declared : 0,
  );

  const fields = new Map<string, string>();
  let file: ParsedMultipartUpload['file'] = null;
  let buffer = Buffer.alloc(0);
  let state: 'preamble' | 'headers' | 'body' | 'done' = 'preamble';
  let currentName: string | null = null;
  let currentFilename: string | null = null;
  let currentMimeType = 'application/octet-stream';
  let currentField = '';
  let fileStream: ReturnType<typeof createWriteStream> | null = null;
  let currentTempPath: string | null = null;
  let currentSize = 0;
  let lastCapacityCheck = 0;

  async function cleanupCurrentFile() {
    if (fileStream) {
      fileStream.destroy();
      await finished(fileStream, { cleanup: true }).catch(() => {});
    }
    fileStream = null;
    if (currentTempPath) await rm(currentTempPath, { force: true }).catch(() => undefined);
    currentTempPath = null;
  }

  async function consumeBodyChunk(chunk: Buffer) {
    if (!currentName) return;
    if (currentFilename !== null) {
      if (!fileStream || !currentTempPath) {
        if (file) return;
        currentTempPath = path.join(tempDir, `multipart-${crypto.randomBytes(16).toString('hex')}`);
        fileStream = createWriteStream(currentTempPath, { flags: 'wx' });
        // Callback propagation plus a listener avoids an unhandled process
        // error if a filesystem failure arrives between streamed writes.
        fileStream.on('error', () => {});
      }
      currentSize += chunk.byteLength;
      if (options.maxFileBytes && options.maxFileBytes > 0 && currentSize > options.maxFileBytes) {
        await cleanupCurrentFile();
        throw new MultipartUploadError(`File exceeds maximum upload size`, 413);
      }
      if (lastCapacityCheck === 0 || currentSize - lastCapacityCheck >= 1024 * 1024) {
        await assertStorageCapacity(tempDir, Math.max(chunk.byteLength, 1024 * 1024));
        lastCapacityCheck = currentSize;
      }
      await writeOrDrain(fileStream, chunk);
      return;
    }

    if (currentField.length + chunk.byteLength > FIELD_SIZE_LIMIT) {
      throw new MultipartUploadError('Multipart field is too large', 413);
    }
    currentField += chunk.toString('utf8');
  }

  async function finishPart() {
    if (!currentName) return;
    if (currentFilename !== null) {
      await closeFileStream(fileStream);
      fileStream = null;
      if (!file && currentTempPath) {
        const completedTempPath = currentTempPath;
        file = {
          path: completedTempPath,
          filename: path.basename(currentFilename) || 'upload',
          mimeType: currentMimeType,
          size: currentSize,
          cleanup: () => rm(completedTempPath, { force: true }),
        };
      } else if (currentTempPath) {
        await rm(currentTempPath, { force: true }).catch(() => undefined);
      }
    } else {
      fields.set(currentName, currentField);
    }
    currentName = null;
    currentFilename = null;
    currentMimeType = 'application/octet-stream';
    currentField = '';
    currentTempPath = null;
    currentSize = 0;
    lastCapacityCheck = 0;
  }

  async function processBuffer(final = false) {
    while (state !== 'done') {
      if (state === 'preamble') {
        const index = buffer.indexOf(boundary);
        if (index < 0) return;
        buffer = buffer.subarray(index + boundary.length);
        if (buffer.subarray(0, 2).toString() === '--') {
          state = 'done';
          return;
        }
        if (buffer.subarray(0, 2).toString() === '\r\n') buffer = buffer.subarray(2);
        state = 'headers';
      }

      if (state === 'headers') {
        const index = buffer.indexOf(HEADER_SEPARATOR);
        if (index < 0) return;
        const headers = parseHeaderBlock(buffer.subarray(0, index));
        const disposition = parseContentDisposition(headers.get('content-disposition'));
        currentName = disposition.name;
        currentFilename = disposition.filename;
        currentMimeType = headers.get('content-type') || 'application/octet-stream';
        currentField = '';
        currentSize = 0;
        currentTempPath = null;
        fileStream = null;
        buffer = buffer.subarray(index + HEADER_SEPARATOR.length);
        state = 'body';
      }

      if (state === 'body') {
        const index = buffer.indexOf(partBoundary);
        if (index >= 0) {
          await consumeBodyChunk(buffer.subarray(0, index));
          await finishPart();
          buffer = buffer.subarray(index + partBoundary.length);
          if (buffer.subarray(0, 2).toString() === '--') {
            state = 'done';
            return;
          }
          if (buffer.subarray(0, 2).toString() === '\r\n') buffer = buffer.subarray(2);
          state = 'headers';
          continue;
        }

        if (buffer.length > tailSize) {
          const safeLength = buffer.length - tailSize;
          await consumeBodyChunk(buffer.subarray(0, safeLength));
          buffer = buffer.subarray(safeLength);
        }
        if (!final) return;
        await cleanupCurrentFile();
        throw new MultipartUploadError('Malformed multipart request', 400);
      }
    }
  }

  try {
    for await (const chunk of Readable.fromWeb(
      request.body as Parameters<typeof Readable.fromWeb>[0],
    )) {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      await processBuffer();
    }
    await processBuffer(true);
  } catch (error) {
    await cleanupCurrentFile();
    const completedFile = file as ParsedMultipartUpload['file'] | null;
    if (completedFile) await completedFile.cleanup().catch(() => undefined);
    throw error;
  }

  return { fields, file };
}
