import { getPageMetadata } from '@/lib/server/pageMetadata';
export const generateMetadata = () => getPageMetadata('favoritesTitle');
import { Library } from '@/components/shelf/Library';
import { getInitialLibraryData } from '@/lib/server/libraryInitialData';
export default async function FavoritesPage() {
  return <Library favorites initialData={await getInitialLibraryData({ favorites: true })} />;
}
