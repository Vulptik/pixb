'use client';

import { useId, useLayoutEffect, useRef } from 'react';

const heartPath =
  'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z';

/** State changes move the liquid surface; mounting a saved favorite stays still. */
export function LiquidHeart({ filled, size = 18 }: { filled: boolean; size?: number }) {
  const clipId = `heart-liquid-${useId()}`;
  const icon = useRef<SVGSVGElement>(null);
  const previous = useRef(filled);
  useLayoutEffect(() => {
    if (previous.current === filled) return;
    if (icon.current) icon.current.dataset.motion = filled ? 'fill' : 'drain';
    previous.current = filled;
  }, [filled]);
  return (
    <svg
      ref={icon}
      className="liquid-heart"
      data-filled={filled}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={clipId}>
          <path d={heartPath} />
        </clipPath>
      </defs>
      <g className="liquid-heart-shape">
        <g clipPath={`url(#${clipId})`}>
          <g className="liquid-heart-fill">
            <path
              className="liquid-heart-wave"
              d="M-12 4Q-6-2 0 4T12 4T24 4T36 4T48 4V34H-12Z"
              fill="currentColor"
            />
          </g>
        </g>
        <path
          d={heartPath}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <g fill="currentColor" className="liquid-heart-splash">
        <circle className="liquid-heart-drop" cx="8" cy="5" r="1.4" />
        <circle className="liquid-heart-drop" cx="12" cy="4" r="1.3" />
        <circle className="liquid-heart-drop" cx="17" cy="5" r="1.5" />
      </g>
      <g fill="currentColor" className="liquid-heart-drips">
        <circle className="liquid-heart-drop" cx="12" cy="20" r="1.5" />
        <circle className="liquid-heart-drop" cx="11" cy="19" r="1" />
      </g>
    </svg>
  );
}
