'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Images, Heart, Layers } from 'lucide-react';
import { useShelfUploads } from './ShelfUploads';
import { Brand } from './Brand';
import { SiteFooter } from './SiteFooter';
import { AccountMenu } from './AccountMenu';
import { ThemeToggle, LocaleToggle } from './AppearanceControls';
import { StorageNotice, StorageUploadControl } from './StorageUsage';
export { ThemeToggle, LocaleToggle } from './AppearanceControls';

const destinations = [
  { href: '/', label: 'library', icon: Images },
  { href: '/favorites', label: 'favorites', icon: Heart },
  { href: '/collections', label: 'collections', icon: Layers },
] as const;
export function ShelfShell({
  children,
  username,
}: {
  children: React.ReactNode;
  username: string;
}) {
  const t = useTranslations('shelf'),
    path = usePathname();
  const uploads = useShelfUploads();
  const collection = /^\/collections\/(\d+)$/.exec(path)?.[1];
  const activeIndex = destinations.findIndex(({ href }) =>
    href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`),
  );
  // The first welcome uses the same quiet shell as account creation. Keep the
  // surrounding upload provider mounted so its picker survives entering Library.
  if (path === '/welcome') return <>{children}</>;
  return (
    <div className="shelf" data-dragging={uploads.dragging || undefined}>
      <header className="topbar">
        <Link href="/" className="topbar-brand">
          <Brand />
        </Link>
        <LocaleToggle />
        <ThemeToggle />
        <StorageUploadControl header />
        <AccountMenu username={username} />
      </header>
      <main className="content">
        <nav className="toolbar" aria-label={t('navigation')}>
          <div className="tabs">
            <span
              className="mobile-nav-indicator"
              aria-hidden="true"
              data-active={activeIndex >= 0}
              style={{ transform: `translateX(${Math.max(0, activeIndex) * 100}%)` }}
            />
            {destinations.map(({ href, label, icon: Icon }, index) => (
              <Link
                key={href}
                className={activeIndex === index ? 'active' : ''}
                aria-current={activeIndex === index ? 'page' : undefined}
                href={href}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{t(label)}</span>
              </Link>
            ))}
          </div>
          <StorageUploadControl collection={collection} />
        </nav>
        <StorageNotice />
        <div className="shelf-view" key={path}>
          {children}
        </div>
      </main>
      <SiteFooter className="shelf-footer" />
    </div>
  );
}
