'use client';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
let scrollLocks = 0;
let previousOverflow = '';
export function Dialog({
  title,
  headerTitle,
  children,
  onClose,
  wide = false,
  canClose = true,
  mobilePresentation,
  headerActions,
  inactive = false,
  fallbackFocusRef,
}: {
  title: string;
  headerTitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  canClose?: boolean;
  mobilePresentation?: 'fullscreen' | 'sheet';
  headerActions?: ReactNode;
  inactive?: boolean;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
}) {
  const panel = useRef<HTMLElement>(null),
    closeRef = useRef(onClose);
  const [closing, setClosing] = useState(false);
  const allowed = useRef(canClose);
  const lastFocused = useRef<HTMLElement | null>(null);
  const wasInactive = useRef(inactive);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestClose = useCallback(() => {
    if (closeTimer.current || !allowed.current) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      closeRef.current();
      return;
    }
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      if (allowed.current) closeRef.current();
      else setClosing(false);
    }, 160);
  }, []);
  useEffect(() => {
    closeRef.current = onClose;
    allowed.current = canClose;
  }, [onClose, canClose]);
  useLayoutEffect(() => {
    const reactivated = wasInactive.current && !inactive;
    wasInactive.current = inactive;
    if (reactivated) {
      const target = lastFocused.current;
      if (target?.isConnected && !target.closest('[inert]') && !target.matches(':disabled')) {
        target.focus({ preventScroll: true });
      } else {
        panel.current
          ?.querySelector<HTMLElement>('button:not(:disabled),input:not(:disabled)')
          ?.focus();
      }
    }
  }, [inactive]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    if (scrollLocks++ === 0) previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!panel.current?.inert) panel.current?.querySelector<HTMLElement>('button,input')?.focus();
    const key = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]:not([inert])');
      if (e.defaultPrevented || dialogs[dialogs.length - 1] !== panel.current) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        requestClose();
      }
      if (e.key === 'Tab') {
        const items = Array.from(
          panel.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input:not(:disabled),select,textarea,[tabindex="0"]',
          ) || [],
        ).filter((x) => x.getClientRects().length > 0);
        const first = items[0],
          last = items.at(-1);
        if (!panel.current?.contains(document.activeElement)) {
          e.preventDefault();
          (e.shiftKey ? last : first)?.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      if (--scrollLocks === 0) document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', key);
      if (previous?.isConnected && previous !== document.body && !previous.closest('[inert]')) {
        previous.focus({ preventScroll: true });
      } else {
        fallbackFocusRef?.current?.focus({ preventScroll: true });
      }
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [fallbackFocusRef, requestClose]);
  const t = useTranslations('shelf');
  return createPortal(
    <div
      className={`modal-backdrop${mobilePresentation ? ` mobile-${mobilePresentation}-backdrop` : ''}`}
      data-state={closing ? 'closed' : 'open'}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <section
        ref={panel}
        className={`${wide ? 'viewer' : 'viewer compact-dialog'}${mobilePresentation ? ` mobile-${mobilePresentation}` : ''}`}
        role="dialog"
        inert={closing || inactive}
        aria-modal={!inactive}
        aria-hidden={inactive || undefined}
        aria-label={title}
        onFocusCapture={(event) => {
          lastFocused.current = event.target as HTMLElement;
        }}
      >
        <header>
          <h2 aria-live={headerTitle ? 'polite' : undefined}>{headerTitle ?? title}</h2>
          {headerActions}
          <button
            className="icon-button"
            disabled={!canClose}
            onClick={requestClose}
            aria-label={t('close')}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}
