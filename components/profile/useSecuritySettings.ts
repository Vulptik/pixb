'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { addToast, useDisclosure } from '@/components/ui/primitives';
import { getApiErrorMessage } from '@/lib/utils/apiErrorMessages';

export type PasskeyItem = {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
};

export function useSecuritySettings() {
  const t = useTranslations('security');
  const tc = useTranslations('common');
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpStatusError, setTotpStatusError] = useState(false);
  const [passkeysError, setPasskeysError] = useState(false);
  const [totpLoading, setTotpLoading] = useState(true);
  const [totpSecret, setTotpSecret] = useState('');
  const [totpUri, setTotpUri] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [totpSubmitting, setTotpSubmitting] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [disableCode, setDisableCode] = useState('');
  const [disableSubmitting, setDisableSubmitting] = useState(false);
  const [totpError, setTotpError] = useState('');
  const [disableError, setDisableError] = useState('');
  const [secretCopied, setSecretCopied] = useState(false);
  const secretCopiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [codesCopied, setCodesCopied] = useState(false);
  const codesCopiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [codesSaved, setCodesSaved] = useState(false);
  const [regenPassword, setRegenPassword] = useState('');
  const [regenTotpCode, setRegenTotpCode] = useState('');
  const [regenSubmitting, setRegenSubmitting] = useState(false);
  const [regenError, setRegenError] = useState('');
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>([]);
  const [passkeysLoading, setPasskeysLoading] = useState(true);
  const [passkeyName, setPasskeyName] = useState('');
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const setupModal = useDisclosure();
  const recoveryModal = useDisclosure();
  const disableModal = useDisclosure();
  const passkeyModal = useDisclosure();
  const regenModal = useDisclosure();

  const fetchTotpStatus = useCallback(async () => {
    setTotpLoading(true);
    setTotpStatusError(false);
    try {
      const res = await fetch('/api/v1/user/totp/status', { credentials: 'include' });
      if (!res.ok) throw new Error('Status unavailable');
      const data = await res.json();
      setTotpEnabled(data.enabled);
    } catch {
      setTotpStatusError(true);
    }
    setTotpLoading(false);
  }, []);

  const fetchPasskeys = useCallback(async () => {
    setPasskeysLoading(true);
    setPasskeysError(false);
    try {
      const res = await fetch('/api/v1/user/passkeys', { credentials: 'include' });
      if (!res.ok) throw new Error('Passkeys unavailable');
      const data = await res.json();
      setPasskeys(data.passkeys);
    } catch {
      setPasskeysError(true);
    }
    setPasskeysLoading(false);
  }, []);

  useEffect(() => {
    void fetchTotpStatus();
    void fetchPasskeys();
  }, [fetchTotpStatus, fetchPasskeys]);

  useEffect(() => {
    return () => {
      if (secretCopiedTimer.current) clearTimeout(secretCopiedTimer.current);
      if (codesCopiedTimer.current) clearTimeout(codesCopiedTimer.current);
    };
  }, []);

  const handleEnableTotp = useCallback(async () => {
    setTotpSubmitting(true);
    try {
      const res = await fetch('/api/v1/user/totp/enable', {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setTotpSecret(data.secret);
        setTotpUri(data.uri);
        setTotpCode('');
        setupModal.onOpen();
      } else {
        addToast({ title: t('failedStartSetup'), color: 'danger' });
      }
    } catch {
      addToast({ title: t('failedStartSetup'), color: 'danger' });
    }
    setTotpSubmitting(false);
  }, [setupModal, t]);

  const handleVerifyTotp = useCallback(async () => {
    setTotpSubmitting(true);
    try {
      const res = await fetch('/api/v1/user/totp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token: totpCode }),
      });
      if (res.ok) {
        const data = await res.json();
        setRecoveryCodes(data.recovery_codes);
        setTotpEnabled(true);
        setTotpError('');
        setCodesSaved(false);
        setupModal.onClose();
        recoveryModal.onOpen();
        addToast({ title: t('totpEnabledToast'), color: 'success' });
      } else {
        setTotpError(t('invalidCode'));
      }
    } catch {
      setTotpError(t('verificationFailed'));
    }
    setTotpSubmitting(false);
  }, [recoveryModal, setupModal, t, totpCode]);

  const handleDisableTotp = useCallback(async () => {
    setDisableSubmitting(true);
    try {
      const res = await fetch('/api/v1/user/totp/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token: disableCode }),
      });
      if (res.ok) {
        setTotpEnabled(false);
        setDisableCode('');
        setDisableError('');
        disableModal.onClose();
        addToast({ title: t('totpDisabledToast'), color: 'success' });
      } else {
        setDisableError(t('invalidCode'));
      }
    } catch {
      setDisableError(t('failedDisable2FA'));
    }
    setDisableSubmitting(false);
  }, [disableCode, disableModal, t]);

  const handleRegenerateCodes = useCallback(async () => {
    setRegenSubmitting(true);
    setRegenError('');
    try {
      const res = await fetch('/api/v1/user/totp/regenerate-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          password: regenPassword || undefined,
          totp_code: regenTotpCode || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setRecoveryCodes(data.recovery_codes);
        setCodesSaved(false);
        setRegenPassword('');
        setRegenTotpCode('');
        regenModal.onClose();
        recoveryModal.onOpen();
        addToast({ title: t('codesRegenerated'), color: 'success' });
      } else {
        const data = await res.json().catch(() => null);
        setRegenError(
          data?.message === '2FA is not enabled.'
            ? t('totpNotEnabled')
            : data?.message === 'Password or TOTP code is required.'
              ? t('regenerateCredentialsRequired')
              : getApiErrorMessage(
                  { message: data?.message, status: res.status },
                  tc,
                  'apiErrorRequestFailed',
                ),
        );
      }
    } catch {
      setRegenError(t('failedRegenerateCodes'));
    }
    setRegenSubmitting(false);
  }, [recoveryModal, regenModal, regenPassword, regenTotpCode, t, tc]);

  const handleAddPasskey = useCallback(async () => {
    setPasskeySubmitting(true);
    try {
      const { startRegistration } = await import('@simplewebauthn/browser');
      const optionsRes = await fetch('/api/v1/user/passkeys/register-options', {
        method: 'POST',
        credentials: 'include',
      });
      if (!optionsRes.ok) {
        addToast({ title: t('failedStartPasskey'), color: 'danger' });
        setPasskeySubmitting(false);
        return;
      }

      const options = await optionsRes.json();
      const credential = await startRegistration({ optionsJSON: options });
      const verifyRes = await fetch('/api/v1/user/passkeys/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: passkeyName.trim(), response: credential }),
      });

      if (verifyRes.ok) {
        addToast({ title: t('passkeyRegistered'), color: 'success' });
        setPasskeyName('');
        passkeyModal.onClose();
        void fetchPasskeys();
      } else {
        addToast({ title: t('registrationFailed'), color: 'danger' });
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        addToast({ title: t('passkeyRegFailed'), color: 'danger' });
      }
    }
    setPasskeySubmitting(false);
  }, [fetchPasskeys, passkeyModal, passkeyName, t]);

  const handleDeletePasskey = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        const res = await fetch(`/api/v1/user/passkeys/${id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        // An earlier attempt or another session may have already removed the passkey.
        if (!res.ok && res.status !== 404) return false;
        setPasskeys((prev) => prev.filter((passkey) => passkey.id !== id));
        addToast({ title: t('passkeyDeleted'), color: 'success' });
        return true;
      } catch {
        return false;
      } finally {
        setDeletingId(null);
      }
    },
    [t],
  );

  const copySecret = useCallback(async () => {
    setSecretCopied(false);
    try {
      await navigator.clipboard.writeText(totpSecret);
      setSecretCopied(true);
      if (secretCopiedTimer.current) clearTimeout(secretCopiedTimer.current);
      secretCopiedTimer.current = setTimeout(() => setSecretCopied(false), 2000);
    } catch {
      addToast({ title: t('copyFailed'), color: 'danger' });
    }
  }, [totpSecret, t]);

  const copyRecoveryCodes = useCallback(async () => {
    setCodesCopied(false);
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setCodesCopied(true);
      if (codesCopiedTimer.current) clearTimeout(codesCopiedTimer.current);
      codesCopiedTimer.current = setTimeout(() => setCodesCopied(false), 2000);
    } catch {
      addToast({ title: t('copyFailed'), color: 'danger' });
    }
  }, [recoveryCodes, t]);

  const downloadRecoveryCodes = useCallback(() => {
    const content = `${t('recoveryFileTitle')}\n${'='.repeat(30)}\n\n${recoveryCodes.join('\n')}\n\n${t('recoveryFileSingleUse')}\n${t('recoveryFileGenerated', { date: new Date().toISOString() })}\n`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'pixb-recovery-codes.txt';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [recoveryCodes, t]);

  const openRegenerateModal = useCallback(() => {
    setRegenPassword('');
    setRegenTotpCode('');
    setRegenError('');
    regenModal.onOpen();
  }, [regenModal]);

  return {
    codesCopied,
    codesSaved,
    copyRecoveryCodes,
    copySecret,
    deletingId,
    disableCode,
    disableError,
    disableModal,
    disableSubmitting,
    downloadRecoveryCodes,
    handleAddPasskey,
    handleDeletePasskey,
    handleDisableTotp,
    handleEnableTotp,
    handleRegenerateCodes,
    handleVerifyTotp,
    isLoading: totpLoading || passkeysLoading,
    openRegenerateModal,
    passkeyModal,
    passkeyName,
    passkeySubmitting,
    passkeys,
    passkeysError,
    totpStatusError,
    fetchPasskeys,
    fetchTotpStatus,
    recoveryCodes,
    recoveryModal,
    regenError,
    regenModal,
    regenPassword,
    regenSubmitting,
    regenTotpCode,
    secretCopied,
    setCodesSaved,
    setDisableCode,
    setDisableError,
    setPasskeyName,
    setRegenError,
    setRegenPassword,
    setRegenTotpCode,
    setTotpCode,
    setTotpError,
    setupModal,
    totpCode,
    totpEnabled,
    totpError,
    totpSecret,
    totpSubmitting,
    totpUri,
  };
}

export type SecuritySettingsState = ReturnType<typeof useSecuritySettings>;
