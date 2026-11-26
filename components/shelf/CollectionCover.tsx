'use client';

import { Layers } from 'lucide-react';
import type { CollectionPreview } from '@/types/library';
import { FileIcon, PreviewThumbnail } from './FilePreview';

export function CollectionCover({
  previews = [],
  priority = false,
}: {
  previews?: CollectionPreview[];
  priority?: boolean;
}) {
  const items = previews.slice(0, 3);
  return (
    <div className="collection-cover" data-count={items.length} aria-hidden="true">
      {items.length ? (
        items.map((item) => (
          <span className="collection-cover-photo" key={item.id} data-kind={item.kind}>
            {item.thumbnail ? (
              <PreviewThumbnail
                key={item.thumbnail}
                src={item.thumbnail}
                fallback={<FileIcon kind={item.kind} size={32} />}
                priority={priority}
              />
            ) : (
              <FileIcon kind={item.kind} size={32} />
            )}
          </span>
        ))
      ) : (
        <Layers size={42} strokeWidth={1} />
      )}
    </div>
  );
}
