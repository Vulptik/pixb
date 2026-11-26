import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';

import { resolveAvatarToken } from '@/lib/server/avatars/token';

const EXTENSION_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function mimeFromPath(filePath: string) {
  const ext = path.extname(/*turbopackIgnore: true*/ filePath || '').toLowerCase();
  return EXTENSION_MIME[ext] || 'image/webp';
}

export async function serveAvatarFile(token: string, variant?: 'small' | 'medium' | 'large') {
  const user = await resolveAvatarToken(token);
  if (!user || !user.avatar_data) {
    return new Response('Avatar not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  let avatarPath = user.avatar_data;

  if (variant && variant !== 'large') {
    const parsed = path.parse(/*turbopackIgnore: true*/ avatarPath);
    const baseName = parsed.name.replace(/_large$/, '');
    avatarPath = path.join(
      /*turbopackIgnore: true*/ parsed.dir,
      `${baseName}_${variant}${parsed.ext}`,
    );
  }

  const mime = mimeFromPath(avatarPath);
  const filename = path.basename(/*turbopackIgnore: true*/ avatarPath);
  const filePath = path.resolve(/*turbopackIgnore: true*/ avatarPath);

  try {
    const fileStat = await stat(/*turbopackIgnore: true*/ filePath);
    const nodeStream = createReadStream(/*turbopackIgnore: true*/ filePath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    return new Response(webStream, {
      headers: {
        'Content-Type': mime,
        'Content-Disposition': `inline; filename="${filename}"`,
        'Content-Length': fileStat.size.toString(),
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch {
    return new Response('Avatar not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
