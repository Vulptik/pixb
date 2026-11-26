'use client';

import { useTranslations } from 'next-intl';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ThemeToggle, LocaleToggle } from './AppearanceControls';
export { ThemeToggle, LocaleToggle } from './AppearanceControls';
export function AccountPreferences() {
  const t = useTranslations('shelf');
  return (
    <DropdownMenu.Group className="account-preferences" aria-label={t('preferences')}>
      <DropdownMenu.Item asChild onSelect={(event) => event.preventDefault()}>
        <ThemeToggle labelled />
      </DropdownMenu.Item>
      <DropdownMenu.Item asChild onSelect={(event) => event.preventDefault()}>
        <LocaleToggle labelled />
      </DropdownMenu.Item>
    </DropdownMenu.Group>
  );
}
