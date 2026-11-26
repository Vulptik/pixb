import { expect, it } from 'vitest';
import { mediaUidFromPath, mediaUrlExtension } from '@/lib/server/medias/urls';

it.each([
  ['holiday.jpg', 'image/jpeg', '.jpg'],
  ['renamed.png', 'video/mp4', '.mp4'],
  ['no-extension', 'image/gif', '.gif'],
  [
    'REPORT.DOCX',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.docx',
  ],
  ['untrusted.png', 'application/octet-stream', '.bin'],
  ['no-extension', 'application/unknown', ''],
])('chooses a readable extension for %s (%s)', (name, mime, expected) => {
  expect(mediaUrlExtension(name, mime)).toBe(expected);
});

it.each(['OeXDpPe7lF_tCv1gIaGKSHpxwc06B70Q', 'OeXDpPe7lF_tCv1gIaGKSA'])(
  'accepts existing and shorter identifiers with or without an extension',
  (uid) => {
    expect(mediaUidFromPath(uid)).toBe(uid);
    expect(mediaUidFromPath(`${uid}.png`)).toBe(uid);
  },
);

it.each([
  '../image.png',
  'abc/def.png',
  'abc.png.exe',
  'abc.',
  '.png',
  'ab.png',
  'abc.%2f',
  'abc.png/',
])('rejects malformed asset path %s', (value) => {
  expect(mediaUidFromPath(value)).toBeNull();
});
