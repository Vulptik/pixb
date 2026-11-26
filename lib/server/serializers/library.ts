import type { Media } from '@prisma/client';
import type { FileKind, LibraryFile } from '@/types/library';
import { mediaUrlExtension } from '@/lib/server/medias/urls';
export function fileKind(mime: string): FileKind {
  if (mime.startsWith('image/') && mime !== 'image/svg+xml') return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (
    mime === 'application/pdf' ||
    mime.startsWith('text/') ||
    /officedocument|msword|opendocument/.test(mime)
  )
    return 'document';
  return 'other';
}
export function libraryFile(
  media: Media & { collections?: { collection_id: bigint }[] },
  base = '',
): LibraryFile {
  const kind = fileKind(media.mime_type);
  const uid = encodeURIComponent(media.uid);
  const filename = `${uid}${mediaUrlExtension(media.filename, media.mime_type)}`;
  return {
    id: media.id.toString(),
    name: media.filename,
    mime: media.mime_type,
    size: media.size.toString(),
    createdAt: media.created_at.toISOString(),
    kind,
    favorite: media.is_favorite,
    shared: media.is_shared,
    collections: media.collections?.map((c) => c.collection_id.toString()) ?? [],
    links: {
      original: `${base}/raw/${filename}`,
      download: `${base}/dl/${filename}`,
      thumbnail: kind === 'image' || kind === 'video' ? `${base}/thumb/${uid}` : null,
      poster: kind === 'video' ? `${base}/cover/${uid}` : null,
      preview: media.mime_type === 'application/pdf' ? `${base}/preview/${uid}` : null,
      share: `${base}/s/${filename}`,
    },
  };
}
