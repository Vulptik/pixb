import { getPageMetadata } from '@/lib/server/pageMetadata';
import { AuthShell } from '@/components/shelf/AuthShell';
import { Welcome } from '@/components/shelf/Welcome';

export const generateMetadata = () => getPageMetadata('welcomeTitle');

export default function WelcomePage() {
  return (
    <AuthShell>
      <Welcome />
    </AuthShell>
  );
}
