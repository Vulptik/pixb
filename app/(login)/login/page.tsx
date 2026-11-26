import { getPageMetadata } from '@/lib/server/pageMetadata';
export const generateMetadata = () => getPageMetadata('loginTitle');
import { redirect } from 'next/navigation';
import { getSetupStatus } from '@/lib/server/instance';
import { getAuthFromRequest } from '@/lib/server/auth';
import { isEmailConfigured } from '@/lib/server/email';
import { AuthForm } from '@/components/shelf/AuthForm';
export const dynamic = 'force-dynamic';
export default async function LoginPage() {
  if ((await getSetupStatus()).required) redirect('/setup');
  if ((await getAuthFromRequest())?.session) redirect('/');
  return <AuthForm emailConfigured={await isEmailConfigured()} />;
}
