'use client';

import type { ComponentPropsWithRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Languages, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/contexts/ThemeContext';

type ToggleProps = ComponentPropsWithRef<'button'> & { labelled?: boolean };

export function ThemeToggle({ labelled = false, ...props }: ToggleProps) {
  const { themeId, setTheme } = useTheme();
  const t = useTranslations('shelf');
  const showMoon = labelled ? themeId === 'dark' : themeId !== 'dark';
  const Icon = showMoon ? Moon : Sun;
  return (
    <button
      {...props}
      type="button"
      className="theme-toggle icon-button"
      title={t(themeId === 'dark' ? 'switchLight' : 'switchDark')}
      aria-label={t(themeId === 'dark' ? 'switchLight' : 'switchDark')}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) setTheme(themeId === 'dark' ? 'light' : 'dark');
      }}
    >
      <Icon size={17} aria-hidden="true" />
      {labelled && (
        <>
          <span>{t('appearance')}</span>
          <span className="account-preference-value">
            {t(themeId === 'dark' ? 'darkMode' : 'lightMode')}
          </span>
        </>
      )}
    </button>
  );
}

export function LocaleToggle({ labelled = false, ...props }: ToggleProps) {
  const locale = useLocale(),
    router = useRouter();
  const t = useTranslations('shelf');
  return (
    <button
      {...props}
      type="button"
      className="locale"
      aria-label={t('language')}
      onClick={(event) => {
        props.onClick?.(event);
        if (event.defaultPrevented) return;
        const next = locale === 'en' ? 'fr' : 'en';
        document.cookie = `NEXT_LOCALE=${next};path=/;max-age=31536000;SameSite=Lax`;
        void fetch('/api/v1/user/update_locale', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locale: next }),
        }).catch(() => {});
        router.refresh();
      }}
    >
      {labelled ? (
        <>
          <Languages size={17} aria-hidden="true" />
          <span>{t('languageName')}</span>
          <span className="account-preference-value">
            {t(locale === 'en' ? 'english' : 'french')}
          </span>
        </>
      ) : (
        locale.toUpperCase()
      )}
    </button>
  );
}
