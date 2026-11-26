import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { prisma } from '@/lib/db/prisma';
import { authorizeMediaRequestAccess } from '@/lib/server/medias/accessKey';
import { ensureMediaThumbnail, ensureMediaCover } from '@/lib/server/medias/storage';
import { getMediaStorageDir } from '@/lib/server/storagePaths';
import { mediaUidFromPath } from '@/lib/server/medias/urls';

export type FileVariant = 'original' | 'thumb' | 'cover' | 'pdf';
export async function serveFile({
  virtualPath,
  variant,
  download = false,
  request,
  requestHeaders,
}: {
  virtualPath: string;
  variant: FileVariant;
  download?: boolean;
  request?: Request;
  requestHeaders?: Headers;
  urlParams?: URLSearchParams;
}) {
  const uid = mediaUidFromPath(virtualPath);
  if (!uid) return new Response(null, { status: 404 });
  const media = await prisma.media.findFirst({ where: { uid } });
  if (!media || !(await authorizeMediaRequestAccess(media, request)).ok)
    return new Response(null, { status: 404 });
  let file = media.file_data,
    mime = media.mime_type;
  if (variant === 'pdf' && mime !== 'application/pdf') return new Response(null, { status: 404 });
  const base = path.resolve(await getMediaStorageDir());
  const relative = path.relative(base, path.resolve(file));
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error('Invalid file path');
  if (variant === 'thumb' || variant === 'cover') {
    const generated = await (
      variant === 'thumb' ? ensureMediaThumbnail(file, mime) : ensureMediaCover(file, mime)
    ).catch(() => null);
    if (!generated) return new Response(null, { status: 404 });
    file = generated;
    mime = 'image/webp';
  }
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return new Response(null, { status: 404 });
  const inline =
    !download &&
    (variant === 'pdf' ||
      variant === 'thumb' ||
      variant === 'cover' ||
      (mime.startsWith('image/') && mime !== 'image/svg+xml') ||
      mime.startsWith('video/') ||
      mime.startsWith('audio/'));
  const filename = encodeURIComponent(media.filename.replace(/[\r\n]/g, ''));
  const headers = new Headers({
    'Content-Type': mime,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${filename}`,
    'Content-Length': String(info.size),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'self'; sandbox",
  });
  let start = 0,
    end = info.size - 1,
    status = 200;
  const range = (request?.headers || requestHeaders)?.get('range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]))
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${info.size}`, 'Cache-Control': 'no-store' },
      });
    start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start > end ||
      start >= info.size
    )
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${info.size}`, 'Cache-Control': 'no-store' },
      });
    status = 206;
    headers.set('Content-Range', `bytes ${start}-${end}/${info.size}`);
    headers.set('Content-Length', String(end - start + 1));
  }
  if (request?.method === 'HEAD') return new Response(null, { status, headers });
  const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
  return new Response(stream, { status, headers });
}
