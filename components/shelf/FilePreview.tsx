'use client';
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { LoadingMark } from '@/components/ui/LoadingMark';
import { useTranslations } from 'next-intl';
import { File, FileAudio, FileText, Film, Image as ImageIcon } from 'lucide-react';
import type { LibraryFile } from '@/types/library';
export function FileIcon({ kind, size = 38 }: { kind: LibraryFile['kind']; size?: number }) {
  const Icon =
    kind === 'audio'
      ? FileAudio
      : kind === 'video'
        ? Film
        : kind === 'document'
          ? FileText
          : kind === 'image'
            ? ImageIcon
            : File;
  return <Icon size={size} strokeWidth={1.2} />;
}
export function FilePreview({
  file,
  onReady,
}: {
  file: LibraryFile;
  onReady?: (dimensions?: { width: number; height: number }) => void;
}) {
  return (
    <FilePreviewContent
      key={`${file.id}:${file.links.original}:${file.links.preview}`}
      file={file}
      onReady={onReady}
    />
  );
}
function FilePreviewContent({
  file,
  onReady,
}: {
  file: LibraryFile;
  onReady?: (dimensions?: { width: number; height: number }) => void;
}) {
  const t = useTranslations('shelf'),
    [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(
    ['image', 'video', 'audio'].includes(file.kind) || Boolean(file.links.preview),
  );
  const image = useRef<HTMLImageElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const documentPreview = useRef<HTMLObjectElement>(null);
  const ready = useCallback(
    (dimensions?: { width: number; height: number }) => {
      setLoading(false);
      onReady?.(dimensions);
    },
    [onReady],
  );
  const fail = useCallback(() => {
    setFailed(true);
    ready();
  }, [ready]);
  useEffect(() => {
    const element = documentPreview.current;
    element?.addEventListener('error', fail);
    return () => element?.removeEventListener('error', fail);
  }, [fail]);
  useEffect(() => {
    // Cached media can finish before React attaches event handlers.
    if (image.current?.complete) {
      if (image.current.naturalWidth)
        ready({ width: image.current.naturalWidth, height: image.current.naturalHeight });
      else fail();
    } else if (video.current && video.current.readyState > 0) {
      onReady?.({ width: video.current.videoWidth, height: video.current.videoHeight });
      if (video.current.readyState >= 2) setLoading(false);
    } else if (audio.current && audio.current.readyState > 0) ready();
  }, [ready, fail, onReady]);
  return (
    <div className="file-preview" aria-busy={loading} data-loading={loading || undefined}>
      {loading && (
        <div className="media-loading" role="status" aria-label={t('loading')}>
          <LoadingMark size={32} />
        </div>
      )}
      {!failed && file.kind === 'image' ? (
        <img
          ref={image}
          src={file.links.original}
          alt={file.name}
          draggable={false}
          onLoad={(event) =>
            ready({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          onError={fail}
        />
      ) : !failed && file.kind === 'video' ? (
        <video
          ref={video}
          controls
          preload="metadata"
          playsInline
          poster={file.links.poster || undefined}
          src={file.links.original}
          onLoadedMetadata={(event) =>
            onReady?.({
              width: event.currentTarget.videoWidth,
              height: event.currentTarget.videoHeight,
            })
          }
          onLoadedData={() => setLoading(false)}
          onWaiting={() => setLoading(true)}
          onPlaying={() => setLoading(false)}
          onCanPlay={() => setLoading(false)}
          onError={fail}
        >
          {t('playbackFallback')}
        </video>
      ) : !failed && file.kind === 'audio' ? (
        <div className="audio-preview">
          <FileIcon kind="audio" size={55} />
          <audio
            ref={audio}
            controls
            preload="metadata"
            src={file.links.original}
            onLoadedMetadata={() => ready()}
            onWaiting={() => setLoading(true)}
            onPlaying={() => setLoading(false)}
            onCanPlay={() => setLoading(false)}
            onError={fail}
          >
            {t('playbackFallback')}
          </audio>
        </div>
      ) : file.links.preview && !failed ? (
        <div className="pdf-preview">
          <object
            ref={documentPreview}
            data={file.links.preview}
            type="application/pdf"
            aria-label={file.name}
            onLoad={() => ready()}
            onError={fail}
          >
            <p>{t('previewFallback')}</p>
          </object>
        </div>
      ) : (
        <div className="download-preview">
          <FileIcon kind={file.kind} size={55} />
          <p>{t('previewFallback')}</p>
        </div>
      )}
    </div>
  );
}
export function FileThumbnail({
  file,
  priority = false,
}: {
  file: LibraryFile;
  priority?: boolean;
}) {
  const fallback = (
    <span className="file-placeholder">
      <FileIcon kind={file.kind} size={64} />
      <small>{file.name.split('.').pop()?.toUpperCase().slice(0, 10)}</small>
    </span>
  );
  return file.links.thumbnail ? (
    <PreviewThumbnail
      key={file.links.thumbnail}
      src={file.links.thumbnail}
      fallback={fallback}
      priority={priority}
    />
  ) : (
    fallback
  );
}
export function PreviewThumbnail({
  src,
  fallback,
  priority = false,
}: {
  src: string;
  fallback: ReactNode;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const indicator = !loaded && (
    <span className="thumbnail-loading" aria-hidden="true">
      <LoadingMark size={22} />
    </span>
  );
  useEffect(() => {
    if (image.current?.complete) {
      if (image.current.naturalWidth) setLoaded(true);
      else setFailed(true);
    }
  }, []);
  return failed ? (
    fallback
  ) : (
    <>
      {priority && indicator}
      <img
        ref={image}
        src={src}
        alt=""
        draggable={false}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        data-priority={priority || undefined}
        data-pending={(!priority && !loaded) || undefined}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
      {!priority && indicator}
    </>
  );
}
