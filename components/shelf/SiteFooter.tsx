'use client';

import { useTranslations } from 'next-intl';
import { PixbMark } from './Brand';

export function SiteFooter({ className = '' }: { className?: string }) {
  const t = useTranslations('shelf');
  return (
    <footer className={`site-footer ${className}`}>
      <div className="footer-identity">
        <PixbMark />
        <span>{t('footerCopyright', { year: new Date().getFullYear() })}</span>
      </div>
      <p>
        {t.rich('footerCredit', {
          author: (name) => (
            <a href="https://vulptik.dev" target="_blank" rel="noreferrer" title={t('authorBlog')}>
              {name}
            </a>
          ),
        })}
      </p>
    </footer>
  );
}
