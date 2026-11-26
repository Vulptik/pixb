import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { libraryFile } from '@/lib/server/library';
import { getAppUrlFromHeaders } from '@/lib/server/appUrl';
import { mediaUidFromPath } from '@/lib/server/medias/urls';
import { Recipient } from '@/components/shelf/Recipient';
export const dynamic = 'force-dynamic';

type SharedFileProps = { params: Promise<{ id: string }> };

// Metadata and the viewer must use the same public-only access check, even for owners.
const sharedMedia = cache(async (id: string) => {
  const uid = mediaUidFromPath(id);
  if (!uid) notFound();
  const media = await prisma.media.findFirst({ where: { uid, is_shared: true } });
  if (!media) notFound();
  return media;
});

export async function generateMetadata({ params }: SharedFileProps): Promise<Metadata> {
  const media = await sharedMedia((await params).id);
  const base = await getAppUrlFromHeaders(await headers());
  const file = libraryFile(media, base);
  // Point crawlers at originals (including animated images), not small thumbnails.
  const images =
    file.kind === 'image'
      ? [{ url: file.links.original, type: file.mime, alt: file.name }]
      : file.kind === 'video' && file.links.poster
        ? [{ url: file.links.poster, type: 'image/webp', alt: file.name }]
        : [];
  return {
    title: file.name,
    description: file.mime,
    openGraph: {
      title: file.name,
      description: file.mime,
      url: file.links.share,
      type: file.kind === 'video' ? 'video.other' : 'website',
      images,
      ...(file.kind === 'video' && {
        videos: [{ url: file.links.original, type: file.mime }],
      }),
      ...(file.kind === 'audio' && {
        audio: [{ url: file.links.original, type: file.mime }],
      }),
    },
    twitter: {
      card: images.length ? 'summary_large_image' : 'summary',
      title: file.name,
      description: file.mime,
      images,
    },
  };
}

export default async function SharedFilePage({ params }: SharedFileProps) {
  const media = await sharedMedia((await params).id);
  const file = libraryFile(media);
  file.collections = [];
  file.favorite = false;
  return <Recipient file={file} />;
}
