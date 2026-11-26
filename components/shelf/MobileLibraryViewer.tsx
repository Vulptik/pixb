'use client';

import { useCallback, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatFileSize } from '@/lib/utils/fileSize';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Copy,
  Info,
  Layers,
  Link2Off,
  MoreHorizontal,
  Pencil,
  Share2,
  Trash2,
} from 'lucide-react';
import type { LibraryFile } from '@/types/library';
import { Dialog } from './Dialog';
import { FilePreview } from './FilePreview';
import { RecipientImage, type MediaDimensions } from './RecipientImage';
import { LiquidHeart } from './LiquidHeart';
import { LoadingMark } from '@/components/ui/LoadingMark';

type Props = {
  inactive?: boolean;
  file: LibraryFile;
  previousFile?: LibraryFile;
  nextFile?: LibraryFile;
  position: number;
  total: number;
  busy: boolean;
  sharingOperation: 'copy' | 'revoke' | null;
  onClose: () => void;
  onNavigate: (direction: -1 | 1) => void;
  onFavorite: () => void;
  onCopy: () => void;
  onRevoke: () => void;
  onAction: (action: 'rename' | 'organize' | 'delete') => void;
};

export function MobileLibraryViewer({
  inactive = false,
  file,
  previousFile,
  nextFile,
  position,
  total,
  busy,
  sharingOperation,
  onClose,
  onNavigate,
  onFavorite,
  onCopy,
  onRevoke,
  onAction,
}: Props) {
  const t = useTranslations('shelf'),
    tc = useTranslations('common'),
    locale = useLocale();
  const [sheet, setSheet] = useState<'details' | 'actions' | 'share' | null>(null);
  const [dimensions, setDimensions] = useState<(MediaDimensions & { id: string }) | null>(null);
  const ready = useCallback(
    (size: MediaDimensions) => setDimensions({ ...size, id: file.id }),
    [file.id],
  );
  const navigate = (direction: -1 | 1) => {
    if (total > 1) onNavigate(direction);
  };
  const manage = (action: 'rename' | 'organize' | 'delete') => {
    setSheet(null);
    onAction(action);
  };
  return (
    <>
      <Dialog
        title={file.name}
        headerTitle={t('viewerPosition', { current: position, total })}
        onClose={onClose}
        wide
        mobilePresentation="fullscreen"
        inactive={sheet !== null || inactive}
        headerActions={
          <button
            className="icon-button"
            aria-label={t('viewerMore')}
            onClick={() => setSheet('actions')}
          >
            <MoreHorizontal size={22} />
          </button>
        }
      >
        <div className="mobile-viewer-media" data-kind={file.kind}>
          <div className="mobile-viewer-canvas">
            {file.kind === 'image' ? (
              <RecipientImage
                file={file}
                onDimensions={ready}
                controls={null}
                onNavigate={navigate}
                compactTools
                previousFile={total > 1 ? previousFile : undefined}
                nextFile={total > 1 ? nextFile : undefined}
              />
            ) : (
              <SwipeMedia file={file} onNavigate={navigate} />
            )}
          </div>
          {total > 1 && (
            <nav className="mobile-viewer-pagination" aria-label={t('viewerNavigation')}>
              <button
                className="icon-button"
                aria-label={t('previous')}
                onClick={() => navigate(-1)}
              >
                <ArrowLeft size={19} />
              </button>
              <button className="icon-button" aria-label={t('next')} onClick={() => navigate(1)}>
                <ArrowRight size={19} />
              </button>
            </nav>
          )}
        </div>
        <footer className="mobile-viewer-footer">
          <button
            className="mobile-viewer-caption"
            aria-label={`${t('viewerDetails')}: ${file.name}`}
            onClick={() => setSheet('details')}
          >
            <span>{file.name}</span>
            <Info size={18} aria-hidden="true" />
          </button>
          <div className="mobile-viewer-actions">
            <button
              className={file.favorite ? 'is-favorite' : ''}
              aria-label={t(file.favorite ? 'unfavorite' : 'favorite')}
              aria-pressed={file.favorite}
              onClick={onFavorite}
            >
              <LiquidHeart key={file.id} filled={file.favorite} size={22} />
              <span>{t('viewerFavorite')}</span>
            </button>
            <a href={file.links.download} aria-label={t('download')}>
              <ArrowDownToLine size={22} />
              <span>{tc('download')}</span>
            </a>
            <button className="mobile-viewer-share" onClick={() => setSheet('share')}>
              <Share2 size={21} />
              <span>{tc('share')}</span>
            </button>
          </div>
        </footer>
      </Dialog>
      {sheet && !inactive && (
        <Dialog
          title={
            sheet === 'details'
              ? t('viewerDetails')
              : sheet === 'share'
                ? tc('share')
                : t('viewerMore')
          }
          mobilePresentation="sheet"
          onClose={() => setSheet(null)}
          canClose={!busy}
        >
          <div className="mobile-viewer-sheet-body">
            {sheet === 'details' ? (
              <dl className="mobile-viewer-details">
                <div>
                  <dt>{t('viewerName')}</dt>
                  <dd>{file.name}</dd>
                </div>
                <div>
                  <dt>{t('viewerType')}</dt>
                  <dd>{file.mime}</dd>
                </div>
                <div>
                  <dt>{t('viewerSize')}</dt>
                  <dd>
                    {t('viewerSizeValue', {
                      size: formatFileSize(file.size, locale),
                    })}
                  </dd>
                </div>
                {dimensions?.id === file.id && (
                  <div>
                    <dt>{t('viewerResolution')}</dt>
                    <dd>{t('viewerDimensions', dimensions)}</dd>
                  </div>
                )}
              </dl>
            ) : sheet === 'actions' ? (
              <div className="mobile-viewer-sheet-actions">
                <button onClick={() => manage('rename')}>
                  <Pencil size={18} />
                  {t('rename')}
                </button>
                <button onClick={() => manage('organize')}>
                  <Layers size={18} />
                  {t('organize')}
                </button>
                <button className="mobile-viewer-danger" onClick={() => manage('delete')}>
                  <Trash2 size={18} />
                  {t('remove')}
                </button>
              </div>
            ) : (
              <div className="mobile-viewer-sheet-actions">
                <button
                  disabled={busy}
                  aria-busy={sharingOperation === 'copy' || undefined}
                  onClick={onCopy}
                >
                  {sharingOperation === 'copy' ? <LoadingMark size={18} /> : <Copy size={18} />}
                  {t('share')}
                </button>
                {file.shared && (
                  <>
                    <a href={file.links.share} target="_blank" rel="noreferrer">
                      <ArrowUpRight size={18} />
                      {t('preview')}
                    </a>
                    <button
                      className="sharing-revoke"
                      disabled={busy}
                      aria-busy={sharingOperation === 'revoke' || undefined}
                      onClick={onRevoke}
                    >
                      {sharingOperation === 'revoke' ? (
                        <LoadingMark size={18} />
                      ) : (
                        <Link2Off size={18} />
                      )}
                      {t('stopSharing')}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}

/** Leave native playback and document gestures to their own controls. */
function SwipeMedia({ file, onNavigate }: { file: LibraryFile; onNavigate: Props['onNavigate'] }) {
  const start = useRef<{ x: number; y: number; time: number; id: number } | null>(null);
  return (
    <div
      className="mobile-viewer-other-media"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement).closest('button,a,video,audio,object,input')) return;
        if (start.current) {
          start.current = null;
          return;
        }
        start.current = {
          x: event.clientX,
          y: event.clientY,
          time: Date.now(),
          id: event.pointerId,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={(event) => {
        const first = start.current;
        start.current = null;
        if (!first || first.id !== event.pointerId) return;
        const dx = event.clientX - first.x,
          dy = event.clientY - first.y;
        if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4 && Date.now() - first.time < 900)
          onNavigate(dx < 0 ? 1 : -1);
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
    >
      <FilePreview file={file} />
    </div>
  );
}
