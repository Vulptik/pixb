'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowDownToLine, Maximize, Minimize } from 'lucide-react';
import { ThemeToggle } from './AppearanceControls';
import { Brand } from './Brand';
import { SiteFooter } from './SiteFooter';
import { FilePreview } from './FilePreview';
import { RecipientImage, type MediaDimensions } from './RecipientImage';
import type { LibraryFile } from '@/types/library';
import { formatFileSize } from '@/lib/utils/fileSize';
export function Recipient({ file }: { file: LibraryFile }) {
  return <RecipientViewer key={file.links.original} file={file} />;
}
function RecipientViewer({ file }: { file: LibraryFile }) {
  const t = useTranslations('shelf');
  const locale = useLocale();
  const viewer = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<MediaDimensions | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  const ready = useCallback((size?: MediaDimensions) => {
    if (size?.width && size.height) setDimensions(size);
  }, []);
  useEffect(() => {
    setCanFullscreen(Boolean(document.fullscreenEnabled && viewer.current?.requestFullscreen));
    const change = () => setFullscreen(document.fullscreenElement === viewer.current);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  async function toggleFullscreen() {
    setFullscreenError(false);
    try {
      if (document.fullscreenElement === viewer.current) await document.exitFullscreen();
      else await viewer.current?.requestFullscreen();
    } catch {
      setFullscreenError(true);
    }
  }
  const fullscreenControl = canFullscreen && (
    <button
      className="icon-button"
      aria-label={t(fullscreen ? 'viewerExitFullscreen' : 'viewerFullscreen')}
      title={t(fullscreen ? 'viewerExitFullscreen' : 'viewerFullscreen')}
      onClick={() => void toggleFullscreen()}
    >
      {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
    </button>
  );
  const formattedSize = formatFileSize(file.size, locale);
  const format =
    (
      {
        'image/svg+xml': 'SVG',
        'text/plain': 'TXT',
        'application/pdf': 'PDF',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
      } as Record<string, string>
    )[file.mime] ||
    file.mime.split('/')[1]?.replace(/^x-/, '').toUpperCase().slice(0, 12) ||
    t('viewerFile');
  return (
    <div className="recipient">
      <header>
        <Brand />
        <ThemeToggle />
      </header>
      <main>
        <div className="recipient-media" ref={viewer}>
          {file.kind === 'image' ? (
            <RecipientImage file={file} onDimensions={setDimensions} controls={fullscreenControl} />
          ) : (
            <>
              <div className="recipient-stage">
                <FilePreview file={file} onReady={ready} />
              </div>
              {canFullscreen && (
                <div className="recipient-tools recipient-tools-end">{fullscreenControl}</div>
              )}
            </>
          )}
          {fullscreenError && (
            <p className="recipient-error" role="status">
              {t('viewerFullscreenFailed')}
            </p>
          )}
        </div>
        <div className="recipient-caption">
          <div>
            <h1 title={file.name}>{file.name}</h1>
            <p>
              {format}
              {dimensions && <> · {t('viewerDimensions', dimensions)}</>} · {formattedSize}
            </p>
          </div>
          <a className="button primary-button" href={file.links.download}>
            <ArrowDownToLine size={16} />
            {t('download')}
          </a>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
