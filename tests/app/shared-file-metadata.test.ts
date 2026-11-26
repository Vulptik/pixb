import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  findFirst: vi.fn(),
  publicUrl: 'https://files.example.test',
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: { media: { findFirst: state.findFirst } } }));
vi.mock('@/lib/server/instance', () => ({
  getInstanceSettings: async () => ({ publicUrl: state.publicUrl }),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: 'localhost:3001', 'x-forwarded-proto': 'http' }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/lib/server/library', async () => import('@/lib/server/serializers/library'));
vi.mock('@/components/shelf/Recipient', () => ({ Recipient: () => null }));

import { generateMetadata } from '@/app/(recipient)/s/[id]/page';

const props = { params: Promise.resolve({ id: 'public-file' }) };
beforeEach(() => {
  state.publicUrl = 'https://files.example.test';
  state.findFirst.mockReset().mockResolvedValue({
    id: 1n,
    uid: 'public-file',
    filename: 'Holiday.jpg',
    mime_type: 'image/jpeg',
    size: 123n,
    created_at: new Date('2026-10-30T00:00:00Z'),
    is_shared: true,
    is_favorite: true,
  });
});

it('exposes the shared original in image cards with absolute public URLs', async () => {
  const metadata = await generateMetadata(props);
  expect(state.findFirst).toHaveBeenCalledWith({ where: { uid: 'public-file', is_shared: true } });
  expect(metadata.title).toBe('Holiday.jpg');
  expect(metadata.openGraph).toMatchObject({
    url: 'https://files.example.test/s/public-file.jpg',
    images: [
      {
        url: 'https://files.example.test/raw/public-file.jpg',
        type: 'image/jpeg',
        alt: 'Holiday.jpg',
      },
    ],
  });
  expect(metadata.twitter).toMatchObject({
    card: 'summary_large_image',
    images: [{ url: 'https://files.example.test/raw/public-file.jpg' }],
  });
});

it('keeps animated images pointed at the original rather than a static thumbnail', async () => {
  state.findFirst.mockResolvedValue({ ...(await state.findFirst()), mime_type: 'image/gif' });
  expect((await generateMetadata(props)).openGraph).toMatchObject({
    images: [{ url: 'https://files.example.test/raw/public-file.gif', type: 'image/gif' }],
  });
});

it('advertises a video stream and its poster instead of the branding card', async () => {
  state.findFirst.mockResolvedValue({ ...(await state.findFirst()), mime_type: 'video/mp4' });
  expect((await generateMetadata(props)).openGraph).toMatchObject({
    type: 'video.other',
    videos: [{ url: 'https://files.example.test/raw/public-file.mp4', type: 'video/mp4' }],
    images: [{ url: 'https://files.example.test/cover/public-file', type: 'image/webp' }],
  });
});

it('advertises audio and does not inherit an unrelated image for documents', async () => {
  const media = await state.findFirst();
  state.findFirst.mockResolvedValue({ ...media, mime_type: 'audio/mpeg' });
  expect((await generateMetadata(props)).openGraph).toMatchObject({
    audio: [{ url: 'https://files.example.test/raw/public-file.mp3', type: 'audio/mpeg' }],
    images: [],
  });
  state.findFirst.mockResolvedValue({ ...media, mime_type: 'application/pdf' });
  expect((await generateMetadata(props)).twitter).toMatchObject({ card: 'summary', images: [] });
});

it('uses the request origin when no public URL is configured', async () => {
  state.publicUrl = '';
  expect((await generateMetadata(props)).openGraph).toMatchObject({
    images: [{ url: 'http://localhost:3001/raw/public-file.jpg' }],
  });
});

it('returns not found without exposing metadata for private, revoked or missing links', async () => {
  state.findFirst.mockResolvedValue(null);
  await expect(generateMetadata(props)).rejects.toThrow('NEXT_NOT_FOUND');
  expect(state.findFirst).toHaveBeenCalledWith({ where: { uid: 'public-file', is_shared: true } });
});

it('resolves an extension-bearing share link to the same public-only record', async () => {
  await generateMetadata({ params: Promise.resolve({ id: 'public-file.jpg' }) });
  expect(state.findFirst).toHaveBeenCalledWith({ where: { uid: 'public-file', is_shared: true } });
});

it('rejects malformed share identifiers before querying files', async () => {
  await expect(
    generateMetadata({ params: Promise.resolve({ id: 'public-file.png.exe' }) }),
  ).rejects.toThrow('NEXT_NOT_FOUND');
  expect(state.findFirst).not.toHaveBeenCalled();
});
