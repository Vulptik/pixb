import { MIME_EXTENSION_MAP } from '@/lib/utils/mimeTypes';

/** Prefer the stored MIME type so a renamed file cannot advertise a misleading suffix. */
export function mediaUrlExtension(filename: string, mime: string): string {
  return (
    MIME_EXTENSION_MAP[mime] ||
    (mime === 'application/octet-stream'
      ? '.bin'
      : filename.match(/\.[a-z0-9]{1,12}$/i)?.[0].toLowerCase() || '')
  );
}

/** Extensions are a readable hint; access checks and Content-Type still use the media record. */
export function mediaUidFromPath(value: string): string | null {
  return /^([A-Za-z0-9_-]{3,128})(?:\.[A-Za-z0-9]{1,12})?$/.exec(value)?.[1] ?? null;
}
