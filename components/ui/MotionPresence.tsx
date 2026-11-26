'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

export const PRESENCE_EXIT_MS = 180;

/** Keep a closing surface visible briefly, but remove it from interaction immediately. */
export function MotionPresence({
  present,
  children,
  getExitFocus,
  onExitComplete,
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  present: boolean;
  getExitFocus?: () => HTMLElement | null;
  onExitComplete?: () => void;
}) {
  const [retained, setRetained] = useState(present);
  const [entered, setEntered] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [lastChildren, setLastChildren] = useState(children);
  const surface = useRef<HTMLDivElement>(null);
  const finish = useRef(onExitComplete);
  useLayoutEffect(() => {
    finish.current = onExitComplete;
    if (present) setLastChildren(children);
  }, [present, children, onExitComplete]);
  useLayoutEffect(() => {
    // Move focus before the closing render sets inert and aria-hidden.
    if (!present && retained) {
      const active = surface.current?.ownerDocument.activeElement;
      if (active instanceof HTMLElement && surface.current?.contains(active)) {
        getExitFocus?.()?.focus({ preventScroll: true });
        if (active.ownerDocument.activeElement === active) active.blur();
      }
    }
    setExiting(!present && retained);
  }, [getExitFocus, present, retained]);
  useLayoutEffect(() => {
    if (!present || entered) return;
    if (
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      !window.requestAnimationFrame
    ) {
      setEntered(true);
      return;
    }
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [present, entered]);
  useEffect(() => {
    if (present) {
      setRetained(true);
      return;
    }
    if (!retained) return;
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const remove = () => {
      setRetained(false);
      setEntered(false);
      finish.current?.();
    };
    if (preference?.matches) {
      remove();
      return;
    }
    const timer = setTimeout(remove, PRESENCE_EXIT_MS);
    const changed = () => {
      if (preference?.matches) {
        clearTimeout(timer);
        remove();
      }
    };
    preference?.addEventListener?.('change', changed);
    return () => {
      clearTimeout(timer);
      preference?.removeEventListener?.('change', changed);
    };
  }, [present, retained]);
  if (!present && !retained) return null;
  const closed = !present && exiting;
  return (
    <div
      {...props}
      ref={surface}
      className={`motion-presence ${className}`}
      data-presence={closed ? 'closed' : entered ? 'open' : 'entering'}
      inert={closed || props.inert}
      aria-hidden={closed || props['aria-hidden'] || undefined}
    >
      <div className="motion-presence-body">{present ? children : lastChildren}</div>
    </div>
  );
}

/** Retain individual removed rows until their exit finishes; re-added keys cancel removal. */
export function MotionList<T>({
  items,
  getKey,
  getExitFocus,
  children,
}: {
  items: T[];
  getKey: (item: T) => string;
  getExitFocus?: () => HTMLElement | null;
  children: (item: T) => ReactNode;
}) {
  const [records, setRecords] = useState(() =>
    items.map((item) => ({ item, key: getKey(item), present: true })),
  );
  useLayoutEffect(() => {
    setRecords((previous) => {
      const next = items.map((item) => ({ item, key: getKey(item), present: true }));
      const keys = new Set(next.map((record) => record.key));
      previous.forEach((record, index) => {
        if (!keys.has(record.key))
          next.splice(Math.min(index, next.length), 0, { ...record, present: false });
      });
      return next;
    });
  }, [items, getKey]);
  return records.map((record) => (
    <MotionPresence
      key={record.key}
      present={record.present}
      getExitFocus={getExitFocus}
      onExitComplete={() =>
        setRecords((current) => current.filter((item) => item.key !== record.key || item.present))
      }
    >
      {children(record.item)}
    </MotionPresence>
  ));
}
