import { getPageMetadata } from '@/lib/server/pageMetadata';
export const generateMetadata = () => getPageMetadata('settingsTitle');
import { ShelfSettings } from '@/components/shelf/ShelfSettings';
export default function SettingsPage() {
  return <ShelfSettings />;
}
