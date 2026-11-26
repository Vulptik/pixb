import { getPageMetadata } from '@/lib/server/pageMetadata';
export const generateMetadata = () => getPageMetadata('setupTitle');
import { redirect } from 'next/navigation';
import { getSetupStatus } from '@/lib/server/instance';
import { AuthForm } from '@/components/shelf/AuthForm';
export const dynamic = 'force-dynamic';
export default async function SetupPage() {
  if (!(await getSetupStatus()).required) redirect('/login');
  return <AuthForm setup />;
}
