import { JSX } from 'react';
import { redirect } from 'next/navigation';
import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { isEmailConfigured } from '@/lib/server/email';
import ResetPasswordForm from '@/components/public/ResetPasswordForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return { title: t('resetPasswordTitle') };
}

const ResetPasswordPage = async (): Promise<JSX.Element> => {
  if (!(await isEmailConfigured())) {
    redirect('/login');
  }

  return <ResetPasswordForm />;
};

export default ResetPasswordPage;
