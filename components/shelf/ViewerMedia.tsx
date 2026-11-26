'use client';

import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { LibraryFile } from '@/types/library';
import { FilePreview } from './FilePreview';

/** Animate the media stage itself so the dialog and its controls resize together. */
export function ViewerMedia({ file, children }: { file: LibraryFile; children: ReactNode }) {
  const stage = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const errorFrame = useRef<number | null>(null);
  const measure = useCallback(() => {
    if (!stage.current || !content.current) return;
    const image = content.current.querySelector('img');
    const video = content.current.querySelector('video');
    // A new file's unloaded placeholder must not collapse the previous stage.
    if (image && !image.complete) return;
    if (video && video.readyState === 0) return;
    const height = content.current.offsetHeight;
    if (height > 0) stage.current.style.height = `${height}px`;
  }, []);

  useLayoutEffect(() => {
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (content.current) observer?.observe(content.current);
    return () => {
      observer?.disconnect();
      if (errorFrame.current !== null) cancelAnimationFrame(errorFrame.current);
    };
  }, [measure]);

  useLayoutEffect(measure, [file.id, measure]);

  return (
    <div className="viewer-image viewer-media-stage" ref={stage}>
      <div
        className="viewer-media-content"
        ref={content}
        onLoadCapture={measure}
        onLoadedMetadataCapture={measure}
        onErrorCapture={() => {
          // Let FilePreview commit its fallback before measuring it.
          if (errorFrame.current !== null) cancelAnimationFrame(errorFrame.current);
          errorFrame.current = requestAnimationFrame(measure);
        }}
      >
        <FilePreview key={file.id} file={file} />
      </div>
      {children}
    </div>
  );
}
