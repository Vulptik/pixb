'use client';

import { useContext, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Plus } from 'lucide-react';
import UserContext from '@/lib/contexts/UserContext';
import { LibraryIllustration } from './LibraryIllustration';
import { useShelfUploads } from './ShelfUploads';

export function Welcome() {
  const t = useTranslations('shelf');
  const { data: user } = useContext(UserContext);
  const router = useRouter();
  const uploads = useShelfUploads();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section className="welcome-panel" aria-labelledby="welcome-heading">
      <LibraryIllustration />
      <h1 id="welcome-heading" ref={heading} tabIndex={-1}>
        {user?.attributes.username
          ? t('welcomeNamed', { name: user.attributes.username })
          : t('welcomeTitle')}
      </h1>
      <p className="welcome-intro">{t('welcomeHint')}</p>
      <div className="welcome-actions">
        <button
          className="button primary-button"
          onClick={() => {
            // Keep the native picker inside the click gesture. The upload provider
            // and its input survive navigation between these authenticated pages.
            uploads.choose();
            router.replace('/');
          }}
        >
          <Plus size={17} />
          {t('welcomeUpload')}
        </button>
        <button className="text-button" onClick={() => router.replace('/')}>
          {t('welcomeExplore')}
          <ArrowRight size={16} />
        </button>
      </div>
    </section>
  );
}
