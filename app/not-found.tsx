import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/components/shelf/AuthShell';
export default async function NotFound() {
  const t = await getTranslations('shelf');
  return (
    <AuthShell>
      <h1>{t('pageNotFound')}</h1>
      <p>{t('pageNotFoundHint')}</p>
      <Link href="/" className="button primary-button">
        {t('backLibrary')}
      </Link>
    </AuthShell>
  );
}
