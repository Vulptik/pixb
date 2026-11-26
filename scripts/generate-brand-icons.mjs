import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const mark = await readFile(path.join(publicDir, 'logo.svg'), 'utf8');
const badge = mark.replace(
  '<g fill="currentColor"',
  '<rect width="64" height="64" rx="14" fill="#f5f2eb"/><g fill="currentColor"',
);
const png = (size, source = badge) =>
  sharp(Buffer.from(source)).resize(size, size).png().toBuffer();
await writeFile(path.join(publicDir, 'favicon.svg'), mark);
for (const [name, size] of [
  ['favicon-16x16.png', 16],
  ['favicon-32x32.png', 32],
  ['apple-touch-icon.png', 180],
  ['android-chrome-192x192.png', 192],
  ['android-chrome-384x384.png', 384],
  ['icon-512.png', 512],
  ['mstile-150x150.png', 150],
])
  await writeFile(path.join(publicDir, name), await png(size));
await writeFile(path.join(publicDir, 'logo.png'), await png(512, mark));

// ICO supports PNG frames at each native browser size.
const sizes = [16, 32, 48];
const frames = await Promise.all(sizes.map((size) => png(size)));
const header = Buffer.alloc(6 + 16 * frames.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach((frame, i) => {
  const entry = 6 + i * 16;
  header[entry] = sizes[i];
  header[entry + 1] = sizes[i];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
});
await writeFile(path.join(publicDir, 'favicon.ico'), Buffer.concat([header, ...frames]));
await writeFile(
  path.join(publicDir, 'safari-pinned-tab.svg'),
  mark
    .replace(/<style>[\s\S]*?<\/style>/, '')
    .replace('fill="currentColor"', 'fill="black"')
    .replace(/ opacity="[^"]*"/g, ''),
);
console.log('Generated PixB browser and app icons from public/logo.svg.');
