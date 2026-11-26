import type { ReactNode } from 'react';
import { Heart, ImagePlus, Layers, Link2, Search } from 'lucide-react';
import { LibraryIllustration } from './LibraryIllustration';

export function LibraryEmptyState({
  variant,
  title,
  description,
  children,
}: {
  variant: 'library' | 'search' | 'favorites' | 'collection' | 'shared';
  title: string;
  description: string;
  children: ReactNode;
}) {
  const Icon = {
    library: ImagePlus,
    search: Search,
    favorites: Heart,
    collection: Layers,
    shared: Link2,
  }[variant];
  return (
    <div className="library-empty" data-variant={variant}>
      {variant === 'library' ? (
        <LibraryIllustration />
      ) : (
        <Icon size={30} strokeWidth={1.2} className="library-empty-icon" aria-hidden="true" />
      )}
      <h2>{title}</h2>
      <p>{description}</p>
      {children && <div className="library-empty-actions">{children}</div>}
    </div>
  );
}
