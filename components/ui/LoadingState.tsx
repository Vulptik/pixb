'use client';

import { useTranslations } from 'next-intl';
import { LoadingMark } from './LoadingMark';

export function LoadingState({ variant = 'panel' }: { variant?: 'panel' | 'page' | 'inline' }) {
  const t = useTranslations('shelf');
  return (
    <div className={`pixb-loading pixb-loading-${variant}`} role="status" aria-live="polite">
      <LoadingMark size={variant === 'inline' ? 20 : 36} />
      <span>{t('loading')}</span>
    </div>
  );
}
