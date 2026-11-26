'use client';

import { useEffect, useRef, type DetailsHTMLAttributes } from 'react';

/** Preserve native details/summary behavior while animating its actual measured height. */
export function MotionDetails(props: DetailsHTMLAttributes<HTMLDetailsElement>) {
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const details = root.current;
    const summary = details?.querySelector('summary');
    if (!details || !summary) return;
    let animation: Animation | undefined;
    let desiredOpen = details.open;
    details.dataset.expanded = String(desiredOpen);
    const originalOverflow = details.style.overflow;
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const bodies = () =>
      Array.from(details.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement && child !== summary,
      );
    const finish = () => {
      animation?.cancel();
      animation = undefined;
      details.open = desiredOpen;
      details.dataset.expanded = String(desiredOpen);
      details.style.overflow = originalOverflow;
      summary.setAttribute('aria-expanded', String(desiredOpen));
      bodies().forEach((body) => {
        body.removeAttribute('inert');
      });
    };
    const toggle = (event: MouseEvent) => {
      // Links or other controls nested inside the summary keep their own behavior.
      if ((event.target as HTMLElement).closest('a,button,input,select,textarea')) return;
      if (event.defaultPrevented) return;
      event.preventDefault();
      desiredOpen = animation ? !desiredOpen : !details.open;
      const start = details.getBoundingClientRect().height;
      animation?.cancel();
      animation = undefined;
      summary.setAttribute('aria-expanded', String(desiredOpen));
      details.dataset.expanded = String(desiredOpen);
      if (preference?.matches || !details.animate) {
        finish();
        return;
      }
      details.open = desiredOpen;
      const end = details.getBoundingClientRect().height;
      details.open = true;
      details.style.overflow = 'hidden';
      bodies().forEach((body) => {
        body.toggleAttribute('inert', !desiredOpen);
      });
      animation = details.animate([{ height: `${start}px` }, { height: `${end}px` }], {
        duration:
          Number.parseFloat(getComputedStyle(details).getPropertyValue('--motion-disclosure')) ||
          300,
        easing: getComputedStyle(details).getPropertyValue('--motion-ease').trim() || 'ease-out',
        fill: 'both',
      });
      animation.onfinish = finish;
    };
    const changed = () => {
      if (preference?.matches) finish();
    };
    summary.addEventListener('click', toggle);
    preference?.addEventListener?.('change', changed);
    return () => {
      animation?.cancel();
      details.style.overflow = originalOverflow;
      bodies().forEach((body) => {
        body.removeAttribute('inert');
      });
      summary.removeEventListener('click', toggle);
      preference?.removeEventListener?.('change', changed);
    };
  }, [props.open]);
  return <details {...props} ref={root} />;
}
