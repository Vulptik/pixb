'use client';

import { useLayoutEffect, useRef, type HTMLAttributes } from 'react';

/** Animate retained tiles to their new positions; new tiles keep their own entrance. */
export function MotionGrid({
  layoutKey,
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement> & { layoutKey: string }) {
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef(new Map<string, { x: number; y: number }>());
  const running = useRef(new Map<HTMLElement, Animation>());
  useLayoutEffect(
    () => () => {
      running.current.forEach((animation) => animation.cancel());
    },
    [],
  );
  useLayoutEffect(() => {
    const grid = root.current;
    if (!grid) return;
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const measure = () => {
      return Array.from(grid.querySelectorAll<HTMLElement>('[data-motion-key]')).map((node) => {
        return { node, key: node.dataset.motionKey!, x: node.offsetLeft, y: node.offsetTop };
      });
    };
    const offsets = new Map(
      Array.from(running.current.keys()).map((node) => {
        const value = getComputedStyle(node)
          .translate.split(' ')
          .map((part) => Number.parseFloat(part) || 0);
        return [node, { x: value[0] || 0, y: value[1] || 0 }] as const;
      }),
    );
    running.current.forEach((animation) => animation.cancel());
    running.current.clear();
    const tiles = measure();
    const ease = getComputedStyle(grid).getPropertyValue('--motion-ease').trim() || 'ease-out';
    if (!preference?.matches) {
      tiles.forEach(({ node, key, x, y }) => {
        const old = previous.current.get(key);
        const offset = offsets.get(node);
        const dx = old ? old.x + (offset?.x || 0) - x : 0;
        const dy = old ? old.y + (offset?.y || 0) - y : 0;
        if (!old || !node.animate || Math.hypot(dx, dy) < 3) return;
        running.current.set(
          node,
          node.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], {
            duration: 320,
            easing: ease,
          }),
        );
      });
    }
    previous.current = new Map(tiles.map(({ key, x, y }) => [key, { x, y }]));
    const reset = () => {
      running.current.forEach((animation) => animation.cancel());
      running.current.clear();
      previous.current = new Map(measure().map(({ key, x, y }) => [key, { x, y }]));
    };
    window.addEventListener('resize', reset);
    preference?.addEventListener?.('change', reset);
    return () => {
      window.removeEventListener('resize', reset);
      preference?.removeEventListener?.('change', reset);
    };
  }, [layoutKey]);
  return <div {...props} className={`motion-grid ${className}`} ref={root} />;
}
