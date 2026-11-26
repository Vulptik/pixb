import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getPageAuth } from '@/lib/server/pageAuth';
import { getInitialCollections, getInitialLibraryData } from '@/lib/server/libraryInitialData';
import { serializeUser } from '@/lib/server/serializers/user';
import UserProvider from '@/components/providers/UserProvider';
import { ThemeProvider } from '@/lib/contexts/ThemeContext';
import { ShelfUploads } from '@/components/shelf/ShelfUploads';
import { ShelfShell } from '@/components/shelf/ShelfShell';
export const dynamic = 'force-dynamic';
export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const auth = await getPageAuth();
  if (!auth?.user || !auth.session) redirect('/login');
  // Finish the cached initial results before streaming the shell's footer.
  // The page reuses this request-local result instead of querying twice.
  const pathname = (await headers()).get('x-current-path') || '';
  if (pathname === '/') await getInitialLibraryData();
  else if (pathname === '/favorites') await getInitialLibraryData({ favorites: true });
  else if (pathname === '/collections') await getInitialCollections();
  else {
    const collectionId = /^\/collections\/(\d+)$/.exec(pathname)?.[1];
    if (collectionId) await getInitialLibraryData({ collectionId });
  }
  return (
    <UserProvider initialUser={serializeUser(auth.user, '')}>
      <ThemeProvider initialTheme={auth.user.theme} persist>
        <ShelfUploads>
          <ShelfShell username={auth.user.username}>{children}</ShelfShell>
        </ShelfUploads>
      </ThemeProvider>
    </UserProvider>
  );
}
