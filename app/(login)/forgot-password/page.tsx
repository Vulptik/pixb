import { JSX } from 'react';
import { redirect } from 'next/navigation';
import { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { isEmailConfigured } from '@/lib/server/email';
import ForgotPasswordForm from '@/components/public/ForgotPasswordForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return { title: t('forgotPasswordTitle') };
}

const ForgotPasswordPage = async (): Promise<JSX.Element> => {
  if (!(await isEmailConfigured())) {
    redirect('/login');
  }

  return <ForgotPasswordForm />;
};

export default ForgotPasswordPage;
