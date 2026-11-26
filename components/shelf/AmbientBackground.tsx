'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

type Mark = {
  id: number;
  generation: number;
  x: number;
  y: number;
  size: number;
  duration: number;
  delay: number;
};
type Drawing = { width: number; height: number; marks: Mark[] };

// The exact tile geometry and opacity of public/logo.svg.
const tiles = [
  { x: 8, y: 8, opacity: 1 },
  { x: 36, y: 8, opacity: 0.72 },
  { x: 8, y: 36, opacity: 0.45 },
  { x: 36, y: 36, opacity: 1 },
];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Loose placement within separate regions keeps the marks from colliding. */
function createMark(
  id: number,
  generation: number,
  width: number,
  height: number,
  count: number,
): Mark {
  const columns = Math.max(1, Math.round(Math.sqrt((count * width) / height)));
  const rows = Math.ceil(count / columns);
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const row = Math.floor(id / columns);
  const entriesInRow = Math.min(columns, count - row * columns);
  const maxSize = Math.max(12, Math.min(220, cellWidth - 24, cellHeight - 24));
  const minSize = Math.min(64, maxSize * 0.55);
  const size = minSize + Math.random() * (maxSize - minSize);
  const duration = 16 + Math.random() * 8;
  return {
    id,
    generation,
    x:
      ((id % columns) + (columns - entriesInRow) / 2) * cellWidth +
      12 +
      Math.random() * Math.max(0, cellWidth - size - 24),
    y: row * cellHeight + 12 + Math.random() * Math.max(0, cellHeight - size - 24),
    size,
    duration,
    delay: generation === 0 ? -Math.random() * duration * 0.85 : 0,
  };
}

/** Decorative only: shared by the standalone account and fallback pages. */
export function AmbientBackground() {
  const root = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [drawing, setDrawing] = useState<Drawing>({ width: 1, height: 1, marks: [] });
  const [paused, setPaused] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let frame = 0;
    let lastWidth = 0;
    let lastHeight = 0;
    const measure = () => {
      const width = Math.round(element.clientWidth);
      const height = Math.round(element.clientHeight);
      if (!width || !height || (width === lastWidth && height === lastHeight)) return;
      lastWidth = width;
      lastHeight = height;
      const count = clamp(Math.round((width * height) / 220000), 3, 7);
      setDrawing({
        width,
        height,
        marks: Array.from({ length: count }, (_, id) => createMark(id, 0, width, height, count)),
      });
    };
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(element);
    window.addEventListener('resize', resize);
    measure();
    const visibility = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', visibility);
    visibility();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [mounted]);

  if (!mounted) return null;

  // Escape page-width limits and animated ancestors' fixed-position containing blocks.
  return createPortal(
    <div
      ref={root}
      className="ambient-background"
      aria-hidden="true"
      data-paused={paused || undefined}
    >
      <svg
        className="ambient-drawing"
        viewBox={`0 0 ${drawing.width} ${drawing.height}`}
        preserveAspectRatio="none"
        focusable="false"
      >
        {drawing.marks.map((mark) => (
          <svg
            key={`${mark.id}:${mark.generation}`}
            className="ambient-logo"
            x={mark.x}
            y={mark.y}
            width={mark.size}
            height={mark.size}
            viewBox="0 0 64 64"
            focusable="false"
            style={
              {
                '--logo-duration': `${mark.duration}s`,
                '--logo-delay': `${mark.delay}s`,
              } as CSSProperties
            }
            onAnimationEnd={(event) => {
              if (
                event.target !== event.currentTarget ||
                event.animationName !== 'ambient-logo-cycle'
              )
                return;
              setDrawing((current) => ({
                ...current,
                marks: current.marks.map((entry) =>
                  entry.id === mark.id
                    ? createMark(
                        entry.id,
                        entry.generation + 1,
                        current.width,
                        current.height,
                        current.marks.length,
                      )
                    : entry,
                ),
              }));
            }}
          >
            <g transform="rotate(-9 32 32)">
              {tiles.map((tile, index) => (
                <rect
                  key={index}
                  x={tile.x}
                  y={tile.y}
                  width={20}
                  height={20}
                  rx={5.7}
                  opacity={tile.opacity}
                  pathLength={1}
                  style={{ '--tile-stagger': `${index * 0.3}s` } as CSSProperties}
                />
              ))}
            </g>
          </svg>
        ))}
      </svg>
    </div>,
    document.body,
  );
}
