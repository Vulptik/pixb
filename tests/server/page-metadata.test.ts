import { beforeEach, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
const state = vi.hoisted(() => ({
  locale: 'en',
  name: 'PixB',
  publicUrl: 'https://files.example.test',
}));
vi.mock('next-intl/server', () => ({
  getLocale: async () => state.locale,
  getTranslations: async () => (key: keyof typeof en.meta) =>
    (state.locale === 'fr' ? fr : en).meta[key],
}));
vi.mock('@/lib/server/instance', () => ({
  getInstanceSettings: async () => ({ instanceName: state.name, publicUrl: state.publicUrl }),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: 'local.example.test:3001' }),
}));
import { getPageMetadata, getSiteMetadata } from '@/lib/server/pageMetadata';
beforeEach(() => {
  state.locale = 'en';
  state.name = 'PixB';
  state.publicUrl = 'https://files.example.test';
});

it('keeps PixB identity even when old settings contain a custom name', async () => {
  state.name = 'My PixB';
  const metadata = await getSiteMetadata();
  expect(metadata.metadataBase?.href).toBe('https://files.example.test/');
  expect(metadata.title).toEqual({ default: 'PixB', template: '%s · PixB' });
  expect(metadata.openGraph).toMatchObject({
    title: 'PixB',
    siteName: 'PixB',
    images: [{ url: '/og/pixb-en.png', width: 1200, height: 630 }],
  });
  expect(metadata.twitter).toMatchObject({
    card: 'summary_large_image',
    images: [{ url: '/og/pixb-en.png' }],
  });
  expect(metadata.creator).toBeUndefined();
  expect(metadata.authors).toBeUndefined();
  expect(metadata.robots).toEqual({ index: false, follow: false });
});

it('localizes page titles, descriptions and social image alternatives', async () => {
  state.locale = 'fr';
  expect(await getPageMetadata('libraryTitle')).toEqual({ title: 'Bibliothèque' });
  expect(await getPageMetadata('welcomeTitle')).toEqual({ title: 'Bienvenue' });
  const metadata = await getSiteMetadata();
  expect(metadata.description).toBe(fr.meta.appDescription);
  expect(metadata.openGraph).toMatchObject({
    locale: 'fr_FR',
    images: [{ url: '/og/pixb-fr.png', alt: fr.meta.socialImageAlt }],
  });
});

it('uses the request origin as the preview base when no public URL is configured', async () => {
  state.publicUrl = '';
  const metadata = await getSiteMetadata();
  expect(metadata.metadataBase?.origin).toBe('http://local.example.test:3001');
});

it('provides generic fallback titles without querying file or collection data', async () => {
  expect(await getPageMetadata('sharedFileTitle')).toEqual({ title: 'Shared file' });
  expect(await getPageMetadata('collectionTitle')).toEqual({ title: 'Collection' });
});
