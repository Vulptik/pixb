'use client';

import { useEffect, useId, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { RotateCcw } from 'lucide-react';
import { LoadingMark } from '@/components/ui/LoadingMark';
import { AmbientBackground } from './AmbientBackground';

export type ErrorStateProps = {
  error: Error & { digest?: string };
  reset: () => void;
  variant?: 'app' | 'account';
};

export function ErrorState({ error, reset, variant = 'app' }: ErrorStateProps) {
  const t = useTranslations('errors');
  const shelf = useTranslations('shelf');
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    console.error(error);
    heading.current?.focus({ preventScroll: true });
  }, [error]);

  return (
    <section className="page-error ambient-error" aria-labelledby={titleId}>
      {variant === 'app' && <AmbientBackground />}
      <div className="page-error-content">
        <h1 id={titleId} ref={heading} tabIndex={-1}>
          {t('oopsSomethingWentWrong')}
        </h1>
        <p>{t('unexpectedError')}</p>
        <div className="page-error-actions">
          <button
            type="button"
            className="button primary-button"
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={() =>
              startTransition(() => {
                router.refresh();
                reset();
              })
            }
          >
            {pending ? <LoadingMark size={18} /> : <RotateCcw size={18} aria-hidden="true" />}
            {pending ? shelf('working') : t('reload')}
          </button>
          <a className="text-button" href={variant === 'app' ? '/' : '/login'}>
            {variant === 'app' ? shelf('backLibrary') : t('backToSignIn')}
          </a>
        </div>
      </div>
    </section>
  );
}
