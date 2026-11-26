export const IMAGE_TYPES: string[] = [
  'image/heic',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
];

export const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/webm': '.webm',
  'text/plain': '.txt',
  'application/pdf': '.pdf',
  'application/json': '.json',
  'application/zip': '.zip',
  'application/x-7z-compressed': '.7z',
  'application/x-rar-compressed': '.rar',
  'application/x-tar': '.tar',
  'application/gzip': '.gz',
  'application/x-gzip': '.gz',
  'application/x-bzip2': '.bz2',
  'application/x-xz': '.xz',
  'application/x-gameboy-rom': '.gb',
  'application/x-gameboy-color-rom': '.gbc',
  'application/x-gba-rom': '.gba',
  'application/x-nes-rom': '.nes',
  'application/x-snes-rom': '.sfc',
  'application/x-n64-rom': '.n64',
  'application/x-genesis-rom': '.md',
  'application/x-master-system-rom': '.sms',
  'application/x-game-gear-rom': '.gg',
  'application/x-nintendo-ds-rom': '.nds',
  'application/x-nintendo-3ds-rom': '.3ds',
};

const EXTENSION_MIME_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_EXTENSION_MAP)
    .filter(([mime]) => mime !== 'image/jpg' && mime !== 'audio/webm')
    .map(([mime, ext]) => [ext, mime]),
);

Object.assign(EXTENSION_MIME_MAP, {
  '.cb7': 'application/x-7z-compressed',
  '.cbr': 'application/x-rar-compressed',
  '.cbz': 'application/zip',
  '.gb': 'application/x-gameboy-rom',
  '.gbc': 'application/x-gameboy-color-rom',
  '.gba': 'application/x-gba-rom',
  '.nes': 'application/x-nes-rom',
  '.sfc': 'application/x-snes-rom',
  '.smc': 'application/x-snes-rom',
  '.n64': 'application/x-n64-rom',
  '.v64': 'application/x-n64-rom',
  '.z64': 'application/x-n64-rom',
  '.gen': 'application/x-genesis-rom',
  '.smd': 'application/x-genesis-rom',
  '.sms': 'application/x-master-system-rom',
  '.gg': 'application/x-game-gear-rom',
  '.nds': 'application/x-nintendo-ds-rom',
  '.3ds': 'application/x-nintendo-3ds-rom',
  '.cia': 'application/x-nintendo-3ds-rom',
});

export function guessMimeType(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : '';
  return EXTENSION_MIME_MAP[ext] || null;
}

export function resolveUploadMimeType(filename: string, declaredMimeType?: string | null): string {
  const declared = declaredMimeType?.trim();
  if (declared && declared !== 'application/octet-stream') return declared;
  return guessMimeType(filename) || declared || 'application/octet-stream';
}
