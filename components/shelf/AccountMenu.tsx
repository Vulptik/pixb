'use client';

import { useContext, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { LogOut, Settings } from 'lucide-react';
import UserContext from '@/lib/contexts/UserContext';
import { AccountPreferences } from './Preferences';

export function AccountMenu({ username }: { username: string }) {
  const t = useTranslations('shelf');
  const router = useRouter();
  const { data } = useContext(UserContext);
  const name = data?.attributes.username || username;
  const avatar = data?.attributes.avatar.small || '';
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="avatar account-trigger" aria-label={t('account')}>
          {avatar && failedAvatar !== avatar ? (
            // Signed avatar URLs use the existing local avatar endpoint.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" onError={() => setFailedAvatar(avatar)} />
          ) : (
            name.slice(0, 1).toUpperCase()
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="account-menu"
          align="end"
          sideOffset={12}
          collisionPadding={12}
        >
          <AccountPreferences />
          <DropdownMenu.Item asChild>
            <Link href="/settings">
              <Settings size={15} />
              {t('settings')}
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <button
              onClick={async () => {
                await fetch('/auth/logout', { method: 'POST' });
                router.replace('/login');
                router.refresh();
              }}
            >
              <LogOut size={15} />
              {t('logout')}
            </button>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
