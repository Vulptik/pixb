import { getPageMetadata } from '@/lib/server/pageMetadata';
export const generateMetadata = () => getPageMetadata('collectionTitle');
import { Library } from '@/components/shelf/Library';
import { getInitialLibraryData } from '@/lib/server/libraryInitialData';
export default async function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const collectionId = (await params).id;
  return (
    <Library
      collectionId={collectionId}
      initialData={await getInitialLibraryData({ collectionId })}
    />
  );
}
