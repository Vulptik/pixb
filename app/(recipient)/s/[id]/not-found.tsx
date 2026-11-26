import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/components/shelf/AuthShell';

export default async function SharedFileNotFound() {
  const t = await getTranslations('shelf');
  return (
    <AuthShell>
      <h1>{t('unavailable')}</h1>
      <p>{t('sharedFileUnavailableHint')}</p>
      <Link href="/" className="button primary-button">
        {t('backLibrary')}
      </Link>
    </AuthShell>
  );
}
