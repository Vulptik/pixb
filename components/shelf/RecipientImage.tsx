'use client';
/* eslint-disable @next/next/no-img-element */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { LoadingMark } from '@/components/ui/LoadingMark';
import { FileIcon } from './FilePreview';
import type { LibraryFile } from '@/types/library';

type Point = { x: number; y: number };
export type MediaDimensions = { width: number; height: number };

export function RecipientImage({
  file,
  onDimensions,
  controls,
  onNavigate,
  compactTools = false,
  previousFile,
  nextFile,
}: {
  file: LibraryFile;
  onDimensions: (dimensions: MediaDimensions) => void;
  controls: ReactNode;
  onNavigate?: (direction: -1 | 1) => void;
  compactTools?: boolean;
  previousFile?: LibraryFile;
  nextFile?: LibraryFile;
}) {
  const t = useTranslations('shelf');
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [dimensions, setDimensions] = useState<MediaDimensions | null>(null);
  const [bounds, setBounds] = useState({ width: 1, height: 1 });
  const [failed, setFailed] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, Point>());
  const moved = useRef(false);
  const origin = useRef<Point>({ x: 0, y: 0 });
  const gesture = useRef({ multiple: false, time: 0 });
  const lastTap = useRef({ time: 0, x: 0, y: 0 });
  const lastTouch = useRef(0);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const gallery = !!onNavigate && !!(previousFile || nextFile);
  const track = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const resetFrame = useRef<number | null>(null);
  const offset = useRef(0);
  const grabbedOffset = useRef(0);
  const swipeAxis = useRef<'horizontal' | 'vertical' | null>(null);
  const motionPreference = useRef(false);
  const settling = useRef<-1 | 1 | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotion = () => motionPreference.current;
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const update = () => {
      motionPreference.current = media?.matches ?? false;
    };
    update();
    media?.addEventListener('change', update);
    return () => media?.removeEventListener('change', update);
  }, []);
  function paintOffset() {
    frame.current = null;
    track.current?.style.setProperty('--swipe-offset', `${offset.current}px`);
  }
  function moveSlide(value: number, immediate = false) {
    if (!gallery) {
      setSwipeOffset(value);
      return;
    }
    offset.current = value;
    if (immediate) {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      paintOffset();
    } else if (frame.current === null) frame.current = requestAnimationFrame(paintOffset);
  }
  function resetSlide() {
    if (resetFrame.current !== null) cancelAnimationFrame(resetFrame.current);
    track.current?.setAttribute('data-reset', 'true');
    moveSlide(0, true);
    resetFrame.current = requestAnimationFrame(() => {
      track.current?.removeAttribute('data-reset');
      resetFrame.current = null;
    });
  }
  function grabSlide() {
    const element = track.current;
    if (!element) return 0;
    // Read the displayed position once when grabbing, rather than the animation's destination.
    const transform = getComputedStyle(element).transform;
    const matrix = /^matrix(3d)?\((.+)\)$/.exec(transform);
    const values = matrix?.[2].split(',').map(Number);
    const visible = values ? values[matrix?.[1] ? 12 : 4] : offset.current;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = null;
    settling.current = null;
    if (resetFrame.current !== null) cancelAnimationFrame(resetFrame.current);
    resetFrame.current = null;
    stage.current?.setAttribute('data-interacting', 'true');
    element.removeAttribute('data-reset');
    moveSlide(Number.isFinite(visible) ? visible : 0, true);
    return offset.current;
  }
  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (resetFrame.current !== null) cancelAnimationFrame(resetFrame.current);
    },
    [],
  );
  function finishSwipe() {
    const direction = settling.current;
    if (direction === null) return;
    settling.current = null;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = null;
    onNavigate?.(direction);
  }
  const fit = dimensions
    ? Math.min(1, bounds.width / dimensions.width, bounds.height / dimensions.height)
    : 1;
  const width = dimensions ? dimensions.width * fit : 0;
  const height = dimensions ? dimensions.height * fit : 0;
  const maxScale = Math.max(4, 1 / fit);

  useLayoutEffect(() => {
    pointers.current.clear();
    grabbedOffset.current = 0;
    swipeAxis.current = null;
    settling.current = null;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = null;
    resetSlide();
    setView({ scale: 1, x: 0, y: 0 });
    setInteracting(false);
    setFailed(false);
    const element = image.current;
    setDimensions(
      element?.complete && element.naturalWidth
        ? { width: element.naturalWidth, height: element.naturalHeight }
        : null,
    );
    // Reset gesture state before painting a new active image, while retaining its DOM node.
  }, [file.id]);

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    setBounds({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(() => {
      setBounds({ width: element.clientWidth, height: element.clientHeight });
      setView({ scale: 1, x: 0, y: 0 });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function constrain(scale: number, x: number, y: number) {
    scale = Math.max(1, Math.min(maxScale, scale));
    const limitX = Math.max(0, (width * scale - bounds.width) / 2);
    const limitY = Math.max(0, (height * scale - bounds.height) / 2);
    return {
      scale,
      x: Math.max(-limitX, Math.min(limitX, x)),
      y: Math.max(-limitY, Math.min(limitY, y)),
    };
  }
  function zoom(scale: number) {
    setView((v) => constrain(scale, v.x, v.y));
  }
  function toggleZoom(point?: Point) {
    if (!onNavigate || view.scale > 1 || !point || !stage.current) {
      zoom(view.scale > 1 ? 1 : onNavigate ? 2.5 : Math.max(2, 1 / fit));
      return;
    }
    const rect = stage.current.getBoundingClientRect();
    const scale = Math.min(2.5, maxScale);
    setView(
      constrain(
        scale,
        (rect.left + rect.width / 2 - point.x) * (scale - 1),
        (rect.top + rect.height / 2 - point.y) * (scale - 1),
      ),
    );
  }
  const ready = useCallback(
    (element: HTMLImageElement) => {
      if (!element.naturalWidth) return;
      const size = { width: element.naturalWidth, height: element.naturalHeight };
      if (stage.current)
        setBounds({ width: stage.current.clientWidth, height: stage.current.clientHeight });
      setDimensions(size);
      onDimensions(size);
    },
    [onDimensions],
  );
  // Account for images that finished loading before hydration.
  useEffect(() => {
    const element = image.current;
    if (element?.complete) {
      if (element.naturalWidth) ready(element);
      else setFailed(true);
    }
  }, [ready]);

  function move(event: PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1];
    pointers.current.set(event.pointerId, next);
    if (Math.hypot(next.x - origin.current.x, next.y - origin.current.y) > 4) moved.current = true;
    if (other) {
      gesture.current.multiple = true;
      moveSlide(0);
      moved.current = true;
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(next.x - other.x, next.y - other.y);
      if (before < 1) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const anchorX = (previous.x + other.x) / 2 - rect.left - rect.width / 2;
      const anchorY = (previous.y + other.y) / 2 - rect.top - rect.height / 2;
      setView((v) => {
        const scale = Math.max(1, Math.min(maxScale, (v.scale * after) / before));
        const ratio = scale / v.scale;
        return constrain(
          scale,
          anchorX - (anchorX - v.x) * ratio + (next.x - previous.x) / 2,
          anchorY - (anchorY - v.y) * ratio + (next.y - previous.y) / 2,
        );
      });
    } else {
      if (onNavigate && view.scale === 1 && !gesture.current.multiple) {
        const dx = next.x - origin.current.x;
        const dy = next.y - origin.current.y;
        if (swipeAxis.current === null) {
          if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.4)
            swipeAxis.current = 'horizontal';
          else if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx) * 1.4)
            swipeAxis.current = 'vertical';
        }
        if (swipeAxis.current === 'horizontal') {
          moveSlide(
            reducedMotion()
              ? 0
              : gallery
                ? Math.max(-bounds.width, Math.min(bounds.width, grabbedOffset.current + dx))
                : Math.max(-bounds.width * 0.4, Math.min(bounds.width * 0.4, dx * 0.65)),
          );
        }
      }
      if (view.scale > 1)
        setView((v) => constrain(v.scale, v.x + next.x - previous.x, v.y + next.y - previous.y));
    }
  }
  function renderImage(slide: LibraryFile, active: boolean) {
    return active && failed ? (
      <div className="download-preview">
        <FileIcon kind="image" />
        <p>{t('previewFallback')}</p>
      </div>
    ) : (
      <img
        ref={active ? image : undefined}
        data-gallery-current={gallery && active ? 'true' : undefined}
        src={slide.links.original}
        alt={active ? slide.name : ''}
        draggable={false}
        decoding="async"
        fetchPriority={active ? 'high' : 'low'}
        onLoad={active ? (event) => ready(event.currentTarget) : undefined}
        onError={active ? () => setFailed(true) : undefined}
        style={
          active
            ? {
                transform: `translate(${view.x + (gallery ? 0 : swipeOffset)}px, ${view.y}px) scale(${view.scale})`,
              }
            : undefined
        }
      />
    );
  }
  return (
    <>
      <div
        ref={stage}
        className={`recipient-stage recipient-image-stage${view.scale > 1 ? ' is-zoomed' : ''}`}
        data-interacting={interacting || undefined}
        data-gallery={gallery || undefined}
        role="button"
        tabIndex={0}
        aria-label={t(
          onNavigate
            ? view.scale > 1
              ? 'viewerMobileImageZoomed'
              : 'viewerMobileImage'
            : view.scale > 1
              ? 'viewerFit'
              : 'viewerZoomImage',
        )}
        aria-disabled={!dimensions || failed}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (dimensions && !failed) toggleZoom();
          }
          if (event.key === 'Escape' && view.scale > 1) {
            zoom(1);
            if (onNavigate) {
              event.preventDefault();
              event.stopPropagation();
            }
          }
          const directions: Record<string, Point> = {
            ArrowLeft: { x: 60, y: 0 },
            ArrowRight: { x: -60, y: 0 },
            ArrowUp: { x: 0, y: 60 },
            ArrowDown: { x: 0, y: -60 },
          };
          const direction = directions[event.key];
          if (direction && view.scale > 1) {
            event.preventDefault();
            setView((v) => constrain(v.scale, v.x + direction.x, v.y + direction.y));
          }
        }}
        onPointerDown={(event) => {
          if (!dimensions || failed || event.button !== 0) return;
          if (event.pointerType !== 'mouse') lastTouch.current = Date.now();
          if (!pointers.current.size) {
            grabbedOffset.current = gallery && view.scale === 1 ? grabSlide() : 0;
            moved.current = Math.abs(grabbedOffset.current) > 1;
            swipeAxis.current = moved.current ? 'horizontal' : null;
            origin.current = { x: event.clientX, y: event.clientY };
            gesture.current = { multiple: false, time: Date.now() };
          } else {
            gesture.current.multiple = true;
            lastTap.current.time = 0;
          }
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          setInteracting(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={move}
        onPointerUp={(event) => {
          if (!pointers.current.has(event.pointerId)) return;
          const dx = event.clientX - origin.current.x + (gallery ? grabbedOffset.current : 0);
          const dy = event.clientY - origin.current.y;
          const wasSingle = !gesture.current.multiple && pointers.current.size === 1;
          pointers.current.delete(event.pointerId);
          setInteracting(pointers.current.size > 0);
          moveSlide(0, true);
          if (!onNavigate || !wasSingle) return;
          if (
            view.scale === 1 &&
            swipeAxis.current !== 'vertical' &&
            Math.abs(dx) > 55 &&
            Math.abs(dx) > Math.abs(dy) * 1.4 &&
            (Date.now() - gesture.current.time < 900 ||
              (gallery && Math.abs(dx) > bounds.width * 0.25))
          ) {
            lastTap.current.time = 0;
            const direction = dx < 0 ? 1 : -1;
            if (gallery && !reducedMotion()) {
              settling.current = direction;
              moveSlide(-direction * (bounds.width + 12), true);
              settleTimer.current = setTimeout(finishSwipe, 280);
            } else onNavigate(direction);
          } else if (!moved.current && dimensions && !failed && event.pointerType !== 'mouse') {
            const now = Date.now();
            if (
              now - lastTap.current.time < 300 &&
              Math.hypot(event.clientX - lastTap.current.x, event.clientY - lastTap.current.y) < 24
            ) {
              lastTap.current.time = 0;
              toggleZoom({ x: event.clientX, y: event.clientY });
            } else lastTap.current = { time: now, x: event.clientX, y: event.clientY };
          }
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          moved.current = true;
          gesture.current.multiple = true;
          lastTap.current.time = 0;
          moveSlide(0, true);
          setInteracting(pointers.current.size > 0);
        }}
        onLostPointerCapture={(event) => {
          if (pointers.current.has(event.pointerId)) {
            gesture.current.multiple = true;
            moveSlide(0, true);
          }
          pointers.current.delete(event.pointerId);
          setInteracting(pointers.current.size > 0);
        }}
        onClick={() => {
          if (!onNavigate && !moved.current && dimensions && !failed) toggleZoom();
        }}
        onDoubleClick={(event) => {
          // Touch browsers may synthesize dblclick after the pointer-based double tap.
          if (onNavigate && dimensions && !failed && Date.now() - lastTouch.current > 500)
            toggleZoom({ x: event.clientX, y: event.clientY });
        }}
      >
        {gallery ? (
          <div
            ref={track}
            className="recipient-gallery-track"
            onTransitionEnd={(event) => {
              if (event.target === event.currentTarget && event.propertyName === 'transform')
                finishSwipe();
            }}
          >
            {[previousFile, file, nextFile].map((slide, index) => {
              if (!slide) return null;
              const direction = index - 1;
              const active = direction === 0;
              return (
                <div
                  key={
                    index === 0 && previousFile?.id === nextFile?.id
                      ? `${slide.id}:duplicate`
                      : slide.id
                  }
                  className={`recipient-gallery-slide${active ? '' : ' recipient-gallery-neighbor'}`}
                  data-direction={direction}
                  aria-hidden={active ? undefined : 'true'}
                  style={{
                    transform: `translate3d(calc(${direction * 100}% + ${direction * 12}px), 0, 0)`,
                  }}
                >
                  {slide.kind === 'image' ? (
                    renderImage(slide, active)
                  ) : slide.links.poster || slide.links.thumbnail ? (
                    <img
                      src={slide.links.poster || slide.links.thumbnail || undefined}
                      alt=""
                      draggable={false}
                      decoding="async"
                    />
                  ) : (
                    <FileIcon kind={slide.kind} />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          renderImage(file, true)
        )}
        {!dimensions && !failed && (
          <div className="recipient-loading" role="status" aria-label={t('loading')}>
            <LoadingMark size={28} />
          </div>
        )}
      </div>
      <div className="recipient-tools">
        {compactTools ? (
          <button
            className="icon-button"
            disabled={!dimensions || failed}
            aria-label={t(view.scale > 1 ? 'viewerFit' : 'viewerZoomIn')}
            onClick={() => toggleZoom()}
          >
            {view.scale > 1 ? <ZoomOut size={19} /> : <ZoomIn size={19} />}
          </button>
        ) : (
          <div className="recipient-zoom-tools">
            <button
              className="icon-button"
              aria-label={t('viewerZoomOut')}
              title={t('viewerZoomOut')}
              disabled={!dimensions || failed || view.scale <= 1}
              onClick={() => zoom(view.scale / 1.5)}
            >
              <ZoomOut size={18} />
            </button>
            <button
              className="text-button recipient-fit"
              disabled={!dimensions || failed || (view.scale === 1 && fit === 1)}
              onClick={() => zoom(view.scale === 1 ? 1 / fit : 1)}
            >
              {t(view.scale === 1 ? 'viewerOriginalSize' : 'viewerFit')}
            </button>
            <button
              className="icon-button"
              aria-label={t('viewerZoomIn')}
              title={t('viewerZoomIn')}
              disabled={!dimensions || failed || view.scale >= maxScale}
              onClick={() => zoom(view.scale * 1.5)}
            >
              <ZoomIn size={18} />
            </button>
          </div>
        )}
        {controls}
      </div>
    </>
  );
}
