'use client';

import { FC, JSX, useRef, useState } from 'react';
import { Key, Plus, RefreshCw, Shield, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/primitives';
import { LoadingMark } from '@/components/ui/LoadingMark';
import { LoadingState } from '@/components/ui/LoadingState';
import { Dialog } from '@/components/shelf/Dialog';
import { SecuritySettingsModals } from '@/components/profile/SecuritySettingsModals';
import { type PasskeyItem, useSecuritySettings } from '@/components/profile/useSecuritySettings';

const SecuritySettings: FC = (): JSX.Element => {
  const t = useTranslations('security');
  const format = useFormatter();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tc = useTranslations('common');
  const security = useSecuritySettings();
  const regenerateCodesButton = useRef<HTMLButtonElement>(null);
  const addPasskeyButton = useRef<HTMLButtonElement>(null);
  const [passkeyToDelete, setPasskeyToDelete] = useState<PasskeyItem | null>(null);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const deleteInFlight = useRef(false);
  const deleting = security.deletingId !== null;

  const closeDeleteDialog = () => {
    if (!deleteInFlight.current) setPasskeyToDelete(null);
  };

  const confirmDeletePasskey = async () => {
    if (!passkeyToDelete || deleteInFlight.current) return;
    deleteInFlight.current = true;
    setDeleteFailed(false);
    try {
      if (await security.handleDeletePasskey(passkeyToDelete.id)) setPasskeyToDelete(null);
      else setDeleteFailed(true);
    } finally {
      deleteInFlight.current = false;
    }
  };

  if (security.isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="settings-list">
      <section className="settings-group">
        <div className="settings-feature-heading">
          <div className="settings-feature-title">
            <Shield size={18} />
            <h3 className="font-semibold">{t('twoFactorAuth')}</h3>
          </div>
          {!security.totpStatusError && (
            <div className="settings-feature-actions">
              {security.totpEnabled && (
                <Button
                  ref={regenerateCodesButton}
                  size="sm"
                  variant="flat"
                  startContent={<RefreshCw size={14} />}
                  onPress={security.openRegenerateModal}
                >
                  {t('regenerateCodes')}
                </Button>
              )}
              {security.totpEnabled ? (
                <Button size="sm" color="danger" onPress={security.disableModal.onOpen}>
                  {tc('disable')}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="flat"
                  onPress={security.handleEnableTotp}
                  isLoading={security.totpSubmitting}
                >
                  {tc('enable')}
                </Button>
              )}
            </div>
          )}
        </div>
        {security.totpStatusError ? (
          <p className="shelf-error" role="alert">
            {t('failedLoadTotp')}{' '}
            <button className="text-button" onClick={() => void security.fetchTotpStatus()}>
              {t('retry')}
            </button>
          </p>
        ) : (
          <p className="settings-feature-description">
            {security.totpEnabled ? t('totpEnabled') : t('totpDisabled')}
          </p>
        )}
      </section>

      <section>
        <div className="settings-feature-heading">
          <div className="settings-feature-title">
            <Key size={18} />
            <h3 className="font-semibold">{t('passkeys')}</h3>
          </div>
          <Button
            ref={addPasskeyButton}
            className="max-[700px]:min-h-11"
            size="sm"
            variant="flat"
            startContent={<Plus size={14} />}
            onPress={security.passkeyModal.onOpen}
            isDisabled={security.passkeysError}
          >
            {t('addPasskey')}
          </Button>
        </div>
        <p className="settings-feature-description">{t('passkeyDescription')}</p>

        {security.passkeysError && (
          <p className="shelf-error" role="alert">
            {t('failedLoadPasskeys')}{' '}
            <button className="text-button" onClick={() => void security.fetchPasskeys()}>
              {t('retry')}
            </button>
          </p>
        )}
        {!security.passkeysError && security.passkeys.length > 0 && (
          <ul className="mt-3 divide-y divide-divider border-t border-divider">
            {security.passkeys.map((passkey) => (
              <li
                key={passkey.id}
                className="flex items-center justify-between gap-3 py-3 last:pb-0"
              >
                <div className="settings-row-copy">
                  <p className="font-medium text-sm">{passkey.name}</p>
                  <p className="text-sm text-foreground/70">
                    {t('added', {
                      date: format.dateTime(new Date(passkey.created_at), {
                        dateStyle: 'medium',
                        timeZone,
                      }),
                    })}
                    {passkey.last_used_at &&
                      ` | ${t('lastUsed', {
                        date: format.dateTime(new Date(passkey.last_used_at), {
                          dateStyle: 'medium',
                          timeZone,
                        }),
                      })}`}
                  </p>
                </div>
                <Button
                  size="sm"
                  color="danger"
                  variant="flat"
                  isIconOnly
                  className="max-[700px]:size-11 motion-safe:transition-[background-color,color,scale] motion-safe:duration-(--motion-fast) motion-safe:ease-(--motion-ease) motion-safe:active:scale-[0.97]"
                  aria-label={t('deletePasskeyFor', { name: passkey.name })}
                  onPress={(event) => {
                    event.currentTarget.focus({ preventScroll: true });
                    setDeleteFailed(false);
                    setPasskeyToDelete(passkey);
                  }}
                >
                  <Trash2 size={15} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SecuritySettingsModals
        state={security}
        onRecoveryCloseAutoFocus={(event) => {
          event.preventDefault();
          regenerateCodesButton.current?.focus();
        }}
      />
      {passkeyToDelete && (
        <Dialog
          mobilePresentation="sheet"
          title={t('deletePasskey')}
          canClose={!deleting}
          onClose={closeDeleteDialog}
          fallbackFocusRef={addPasskeyButton}
        >
          <div className="shelf-form">
            <p className="[overflow-wrap:anywhere]">
              {t('deletePasskeyWarning', { name: passkeyToDelete.name })}
            </p>
            {deleteFailed && <p role="alert">{t('failedDeletePasskey')}</p>}
            <div className="settings-confirm-actions">
              <Button isDisabled={deleting} onPress={closeDeleteDialog}>
                {tc('cancel')}
              </Button>
              <button
                type="button"
                className="button primary-button"
                disabled={deleting}
                aria-busy={deleting || undefined}
                onClick={() => void confirmDeletePasskey()}
              >
                {deleting && <LoadingMark size={18} />}
                {t('deletePasskey')}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
};

export default SecuritySettings;
