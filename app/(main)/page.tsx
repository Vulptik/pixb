import { getPageMetadata } from '@/lib/server/pageMetadata';
export const generateMetadata = () => getPageMetadata('libraryTitle');
import { Library } from '@/components/shelf/Library';
import { getInitialLibraryData } from '@/lib/server/libraryInitialData';
export default async function LibraryPage() {
  return <Library initialData={await getInitialLibraryData()} />;
}
