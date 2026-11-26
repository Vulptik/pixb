'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ArrowDownToLine, ChevronDown, Plus, Upload, X } from 'lucide-react';
import { useShelfUploads } from './ShelfUploads';
import styles from './StorageUsage.module.css';

function useStorageUsage() {
  const uploads = useShelfUploads();
  const t = useTranslations('storage');
  const format = useFormatter();
  const bytes = (value: number) => {
    const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;
    const index =
      value > 0 ? Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1) : 0;
    return format.number(value / 1024 ** index, {
      style: 'unit',
      unit: units[index],
      unitDisplay: 'short',
      maximumFractionDigits: index ? 1 : 0,
    });
  };
  const quota = uploads.quota;
  const total =
    quota && !quota.unlimited && quota.total !== null && quota.total > 0 ? quota.total : null;
  const used = quota?.used ?? 0;
  const remaining = total === null ? null : Math.max(0, total - used);
  const ratio = total === null ? 0 : used / total;
  const summary =
    total === null
      ? t('unlimitedUsage', { used: bytes(used) })
      : t('usage', { used: bytes(used), total: bytes(total) });
  return { ...uploads, t, format, bytes, total, used, remaining, ratio, summary };
}

/** The header disclosure keeps exact usage reachable without crowding the mobile navigation. */
export function StorageUploadControl({
  collection,
  header = false,
}: {
  collection?: string;
  header?: boolean;
}) {
  const usage = useStorageUsage();
  const shelf = useTranslations('shelf');
  const {
    t,
    quota,
    bytes,
    total,
    used,
    ratio,
    remaining,
    summary,
    pendingBytes,
    pendingFileCount,
  } = usage;
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const disclosure = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const details = useRef<HTMLDivElement>(null);
  const wave = useRef<SVGGElement>(null);
  const hoverWave = useRef<SVGGElement>(null);
  const hoverMotion = useRef<Animation | null>(null);
  const interaction = useRef({ hover: false, focus: false });
  const previous = useRef({ used, pendingBytes });
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState(false);
  const visible = open || peek;

  function moveWave() {
    const element = hoverWave.current;
    if (!element) return;
    const style = getComputedStyle(element);
    const from = style.transform;
    hoverMotion.current?.cancel();
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const active = interaction.current.hover || interaction.current.focus;
    hoverMotion.current = element.animate(
      active
        ? [
            { transform: from },
            { transform: 'translateX(12px)', offset: 0.25 },
            { transform: 'translateX(-12px)', offset: 0.75 },
            { transform: from },
          ]
        : [{ transform: from }, { transform: 'translateX(0)' }],
      {
        duration: active ? 3200 : 600,
        iterations: active ? Infinity : 1,
        easing: active
          ? 'ease-in-out'
          : style.getPropertyValue('--motion-ease').trim() || 'ease-out',
      },
    );
  }

  useEffect(() => {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const stop = () => {
      if (reducedMotion?.matches) hoverMotion.current?.cancel();
    };
    reducedMotion?.addEventListener('change', stop);
    return () => {
      reducedMotion?.removeEventListener('change', stop);
      hoverMotion.current?.cancel();
    };
  }, []);

  useLayoutEffect(() => {
    if (!visible) return;
    const position = () => {
      if (!root.current || !details.current) return;
      const right = root.current.getBoundingClientRect().right;
      const width = details.current.offsetWidth;
      const left = Math.max(16, Math.min(right - width, window.innerWidth - width - 16));
      details.current.style.setProperty('--storage-right', `${right - left - width}px`);
    };
    position();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [visible, ratio]);

  useLayoutEffect(() => {
    if (previous.current.used !== used || previous.current.pendingBytes !== pendingBytes) {
      if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        wave.current?.animate?.(
          [
            { transform: 'translateX(-8px)' },
            { transform: 'translateX(5px)', offset: 0.4 },
            { transform: 'translateX(-2px)', offset: 0.72 },
            { transform: 'translateX(0)' },
          ],
          { duration: 900, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        );
      }
      previous.current = { used, pendingBytes };
    }
  }, [used, pendingBytes]);

  useEffect(() => {
    if (!visible) return;
    const close = () => {
      setOpen(false);
      setPeek(false);
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !disclosure.current?.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (details.current?.contains(document.activeElement)) trigger.current?.focus();
      close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('blur', close);
    };
  }, [visible]);

  if (header && !quota) return null;
  const liquidStyle = {
    '--liquid-y': `${44 - Math.min(ratio, 1) * 44}px`,
    '--projected-y': `${44 - (total === null ? 0 : Math.min((used + pendingBytes) / total, 1)) * 44}px`,
  } as CSSProperties;

  return (
    <div ref={root} className={`${styles.control}${header ? ` ${styles.header}` : ''}`}>
      {!header && (
        <button
          className={`button upload-button ${styles.liquidButton}`}
          data-limited={total !== null}
          aria-label={shelf('upload')}
          title={shelf('upload')}
          aria-describedby={quota ? `${id}-summary` : undefined}
          onClick={() => usage.choose(collection)}
          onPointerEnter={(event) => {
            if (event.pointerType !== 'mouse') return;
            interaction.current.hover = true;
            moveWave();
          }}
          onPointerLeave={() => {
            interaction.current.hover = false;
            moveWave();
          }}
          onFocus={(event) => {
            if (!event.currentTarget.matches(':focus-visible')) return;
            interaction.current.focus = true;
            moveWave();
          }}
          onBlur={() => {
            interaction.current.focus = false;
            moveWave();
          }}
          style={liquidStyle}
        >
          {total !== null && (
            <svg
              className={styles.liquid}
              viewBox="0 0 140 44"
              preserveAspectRatio="none"
              aria-hidden="true"
              focusable="false"
            >
              <g ref={hoverWave} className={styles.hoverWave}>
                <g className={styles.projected} style={{ opacity: pendingBytes ? 1 : 0 }}>
                  <path d="M-20 1Q0-3 20 1T60 1T100 1T140 1T180 1V60H-20Z" />
                </g>
                <g className={styles.level} style={{ opacity: used ? 1 : 0 }}>
                  <g ref={wave}>
                    <path d="M-20 1Q0-3 20 1T60 1T100 1T140 1T180 1V60H-20Z" />
                  </g>
                </g>
              </g>
            </svg>
          )}
          {usage.dragging ? (
            <ArrowDownToLine size={16} strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
          )}
          <span>{shelf('upload')}</span>
        </button>
      )}
      {quota && (
        <div
          ref={disclosure}
          className={styles.disclosure}
          onMouseEnter={() => setPeek(true)}
          onMouseLeave={() => setPeek(false)}
          onFocus={() => setPeek(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setOpen(false);
              setPeek(false);
            }
          }}
        >
          <span className="sr-only" id={`${id}-summary`}>
            {summary}
          </span>
          <button
            ref={trigger}
            className={styles.capacity}
            aria-label={t('detailsLabel', { usage: summary })}
            aria-expanded={visible}
            aria-controls={`${id}-details`}
            onClick={() => {
              setOpen(!open);
              setPeek(false);
              if (!open) void usage.refreshQuota();
            }}
          >
            <span>
              {total === null
                ? '∞'
                : usage.format.number(ratio, { style: 'percent', maximumFractionDigits: 0 })}
            </span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          <div
            ref={details}
            className={styles.details}
            id={`${id}-details`}
            data-open={visible}
            inert={!visible}
            role="region"
            aria-label={t('title')}
          >
            <div className={styles.detailsHeading}>
              <span>{t('title')}</span>
              <span>{total === null ? t('unlimited') : bytes(total)}</span>
            </div>
            <strong>
              {bytes(used)} <small>{t('used')}</small>
            </strong>
            <p>
              {remaining === null ? t('noLimit') : t('remaining', { amount: bytes(remaining) })}
            </p>
            {(pendingBytes > 0 || pendingFileCount > 0) && (
              <div className={styles.queueSummary} role="group" aria-label={t('queueLabel')}>
                <Upload size={15} aria-hidden="true" />
                <span>{bytes(pendingBytes)}</span>
                {pendingFileCount > 0 && (
                  <>
                    <span className={styles.queueSeparator} aria-hidden="true" />
                    <span>{t('filesRemaining', { count: pendingFileCount })}</span>
                  </>
                )}
              </div>
            )}
            {usage.quotaError && (
              <p className={styles.refreshError}>
                {t('refreshFailed')}{' '}
                <button className="text-button" onClick={() => void usage.refreshQuota()}>
                  {t('retry')}
                </button>
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function StorageNotice() {
  const { t, bytes, remaining, ratio, quotaIssue, dismissQuotaIssue } = useStorageUsage();
  if (!quotaIssue && ratio < 0.9) return null;
  return (
    <div className={styles.notice} data-error={quotaIssue}>
      <span role="status">
        {quotaIssue
          ? t('selectionExceeded')
          : ratio >= 1
            ? t('full')
            : t('almostFull', { amount: bytes(remaining ?? 0) })}
      </span>
      {quotaIssue && (
        <button className="icon-button" onClick={dismissQuotaIssue} aria-label={t('dismiss')}>
          <X size={16} />
        </button>
      )}
    </div>
  );
}
