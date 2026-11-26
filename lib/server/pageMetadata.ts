import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getLocale, getTranslations } from 'next-intl/server';
import { getAppUrlFromHeaders } from '@/lib/server/appUrl';

export async function getPageMetadata(
  key:
    | 'libraryTitle'
    | 'favoritesTitle'
    | 'collectionsTitle'
    | 'collectionTitle'
    | 'settingsTitle'
    | 'loginTitle'
    | 'setupTitle'
    | 'welcomeTitle'
    | 'sharedFileTitle',
): Promise<Metadata> {
  const t = await getTranslations('meta');
  return { title: t(key) };
}

export async function getSiteMetadata(): Promise<Metadata> {
  const [locale, t, incoming] = await Promise.all([
    getLocale(),
    getTranslations('meta'),
    headers(),
  ]);
  const base = await getAppUrlFromHeaders(
    incoming,
    `http://localhost:${process.env.PORT || '3000'}`,
  );
  const name = 'PixB';
  const image = {
    url: `/og/pixb-${locale === 'fr' ? 'fr' : 'en'}.png`,
    width: 1200,
    height: 630,
    alt: t('socialImageAlt'),
  };
  return {
    metadataBase: new URL(base),
    applicationName: name,
    title: { default: name, template: `%s · ${name}` },
    description: t('appDescription'),
    // A private application, including its explicitly shared recipient pages.
    robots: { index: false, follow: false },
    openGraph: {
      type: 'website',
      siteName: name,
      title: name,
      description: t('appDescription'),
      locale: locale === 'fr' ? 'fr_FR' : 'en_US',
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title: name,
      description: t('appDescription'),
      images: [image],
    },
  };
}
