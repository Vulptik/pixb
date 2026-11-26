'use client';

import { useId } from 'react';
import { ArrowUpRight, ImagePlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useShelfUploads } from './ShelfUploads';

/** Uploads stay discoverable independently of the current results or filters. */
export function LibraryUploadCard({ collectionId }: { collectionId?: string }) {
  const t = useTranslations('shelf');
  const uploads = useShelfUploads();
  const hintId = useId();
  return (
    <button
      type="button"
      className="drop-card library-drop-zone"
      aria-label={t(uploads.dragging ? 'releaseToUpload' : 'drop')}
      aria-describedby={hintId}
      onClick={() => uploads.choose(collectionId)}
    >
      <span className="drop-icon" aria-hidden="true">
        <ImagePlus size={25} strokeWidth={1.3} />
        <span className="tiny-plus">+</span>
      </span>
      <span className="drop-zone-copy" id={hintId}>
        <strong>{t(uploads.dragging ? 'releaseToUpload' : 'drop')}</strong>
        <span>
          {t('dropHint')} <u>{t('browse')}</u>
        </span>
        <small>
          {t('dropFormats')} ·{' '}
          {t(collectionId ? 'dropDestinationCollection' : 'dropDestinationLibrary')}
        </small>
      </span>
      <ArrowUpRight className="drop-zone-arrow" size={19} aria-hidden="true" />
    </button>
  );
}
