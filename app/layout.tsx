import '@/styles/index.css';
// Load the shared shell's module styles with the document, not during hydration.
import '@/components/shelf/StorageUsage.module.css';
import { cookies } from 'next/headers';
import { getLocale, getMessages } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';
import { RootThemeProvider } from '@/components/providers/RootThemeProvider';
import { getSiteMetadata } from '@/lib/server/pageMetadata';
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};
export async function generateMetadata() {
  return {
    ...(await getSiteMetadata()),
    manifest: '/manifest.json?v=2',
    icons: {
      icon: [
        { url: '/favicon.svg?v=2', type: 'image/svg+xml', sizes: 'any' },
        { url: '/favicon-32x32.png?v=2', type: 'image/png', sizes: '32x32' },
        { url: '/favicon-16x16.png?v=2', type: 'image/png', sizes: '16x16' },
      ],
      shortcut: '/favicon.ico?v=2',
      apple: { url: '/apple-touch-icon.png?v=2', sizes: '180x180' },
    },
  };
}
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, messages, cookieStore] = await Promise.all([
    getLocale(),
    getMessages(),
    cookies(),
  ]);
  const stored = cookieStore.get('pixb_theme')?.value;
  const theme = stored === 'dark' ? 'dark' : stored === 'light' ? 'light' : 'system';
  const init =
    "(()=>{try{const c=document.cookie.match(/(?:^|;\\s*)pixb_theme=(light|dark)(?:;|$)/)?.[1];const t=c||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t;document.documentElement.classList.toggle('dark',t==='dark')}catch{}})()";
  return (
    <html
      lang={locale}
      data-theme={theme === 'system' ? undefined : theme}
      suppressHydrationWarning
    >
      <head>
        <link
          rel="preload"
          href="/fonts/source-sans-3.latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/lora.latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <meta name="theme-color" content={theme === 'dark' ? '#0f0f0f' : '#f5f2eb'} />
        <script dangerouslySetInnerHTML={{ __html: init }} />
      </head>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <RootThemeProvider initialTheme={theme}>{children}</RootThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
