'use client';

import { useRef, useState } from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/primitives';

export function ApiKeySecret({ secret, onClose }: { secret: string; onClose?: () => void }) {
  const t = useTranslations('shelf');
  const tc = useTranslations('common');
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const code = useRef<HTMLElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopied(false);
      setCopyFailed(true);
      if (code.current) {
        const range = document.createRange();
        range.selectNodeContents(code.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }

  return (
    <div className="shelf-form key-secret">
      <p className="key-secret-notice">
        <KeyRound size={18} aria-hidden="true" />
        <span>{t('keyCreated')}</span>
      </p>
      <div className="key-secret-value">
        <code ref={code}>{secret}</code>
      </div>
      <div className="dialog-actions">
        {onClose && <Button onPress={onClose}>{tc('done')}</Button>}
        <button type="button" className="button primary-button" onClick={() => void copy()}>
          {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          {t('copyKey')}
        </button>
      </div>
      <span className="key-secret-feedback" role="status">
        {copied ? tc('copied') : copyFailed ? t('keyCopyFallback') : ''}
      </span>
    </div>
  );
}
