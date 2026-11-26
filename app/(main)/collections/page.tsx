import { getPageMetadata } from '@/lib/server/pageMetadata';
export const generateMetadata = () => getPageMetadata('collectionsTitle');
import { Collections } from '@/components/shelf/Collections';
import { getInitialCollections } from '@/lib/server/libraryInitialData';
export default async function CollectionsPage() {
  return <Collections initialCollections={await getInitialCollections()} />;
}
