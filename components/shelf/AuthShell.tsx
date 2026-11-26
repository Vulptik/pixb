'use client';
import Link from 'next/link';
import { ThemeToggle, LocaleToggle } from './AppearanceControls';
import { Brand } from './Brand';
import { SiteFooter } from './SiteFooter';
import { AmbientBackground } from './AmbientBackground';
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell">
      <AmbientBackground />
      <header>
        <Link href="/" aria-label="PixB">
          <Brand />
        </Link>
        <div className="auth-actions">
          <LocaleToggle />
          <ThemeToggle />
        </div>
      </header>
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}
