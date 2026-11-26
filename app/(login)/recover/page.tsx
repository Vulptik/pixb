import { JSX } from 'react';
import { redirect } from 'next/navigation';
import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { prisma } from '@/lib/db/prisma';
import RecoverForm from '@/components/public/RecoverForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return { title: t('recoverTitle') };
}

const RecoverPage = async (): Promise<JSX.Element> => {
  if (process.env.RECOVERY_MODE !== 'true') {
    redirect('/login');
  }

  const flag = await prisma.setting.findUnique({
    where: { key: 'recovery.used' },
    select: { value: true },
  });

  if (flag?.value === 'true') {
    redirect('/login');
  }

  return <RecoverForm />;
};

export default RecoverPage;
