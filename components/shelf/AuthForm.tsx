'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  WebAuthnAbortService,
} from '@simplewebauthn/browser';
import { getApiErrorMessage, getApiFieldErrors } from '@/lib/utils/apiErrorMessages';
import { USERNAME_MIN, USERNAME_MAX } from '@/lib/utils/validationPatterns';
import { validateAccountForm } from '@/lib/utils/accountValidation';
import { ArrowRight, Fingerprint, UserRound } from 'lucide-react';
import { LoadingMark } from '@/components/ui/LoadingMark';
import { PasswordField, PasswordFields } from '@/components/ui/PasswordField';
import { FormError } from '@/components/ui/FormError';
export function AuthForm({
  setup = false,
  emailConfigured = false,
}: {
  setup?: boolean;
  emailConfigured?: boolean;
}) {
  const t = useTranslations('shelf'),
    tc = useTranslations('common'),
    tv = useTranslations('validation'),
    router = useRouter();
  const [busy, setBusy] = useState<'password' | 'passkey' | null>(null),
    [error, setError] = useState(''),
    [challenge, setChallenge] = useState(''),
    [recovery, setRecovery] = useState(false),
    [fieldErrors, setFieldErrors] = useState<Record<string, string>>({}),
    [attempt, setAttempt] = useState(0),
    [autofillAttempt, setAutofillAttempt] = useState(0);
  // Offer saved passkeys inside the login field's autofill menu. The pending request
  // stays silent until a passkey is picked; the explicit button aborts and re-arms it.
  useEffect(() => {
    if (setup || challenge) return;
    let active = true,
      chosen = false;
    (async () => {
      if (!(await browserSupportsWebAuthnAutofill())) return;
      const options = await fetch('/api/v1/sessions/passkey-options', { method: 'POST' });
      if (!options.ok) return;
      const optionsJSON = await options.json();
      if (!active) return;
      const response = await startAuthentication({ optionsJSON, useBrowserAutofill: true });
      chosen = true;
      setBusy('passkey');
      setError('');
      const result = await fetch('/api/v1/sessions/passkey-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      });
      if (!result.ok) throw new Error();
      router.replace('/');
      router.refresh();
    })().catch(() => {
      // Aborts and unsupported setups stay quiet; only a picked passkey that fails is reported.
      if (!active || !chosen) return;
      setError(t('passkeyFailed'));
      setBusy(null);
      setAutofillAttempt((n) => n + 1);
    });
    return () => {
      active = false;
      if (!chosen) WebAuthnAbortService.cancelCeremony();
    };
  }, [setup, challenge, autofillAttempt, router, t]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAttempt((value) => value + 1);
    setError('');
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const issues = setup ? validateAccountForm(values, tv) : {};
    setFieldErrors(issues);
    if (Object.keys(issues).length) {
      setError(tc('formReviewFields'));
      return;
    }
    setBusy('password');
    try {
      const url = setup
        ? '/api/v1/setup'
        : challenge
          ? '/api/v1/sessions/verify-totp'
          : '/api/v1/sessions';
      const body = setup
        ? { admin: values }
        : challenge
          ? { challenge, code: String(values.code).replace(/-/g, ''), is_recovery: recovery }
          : { user: { login: values.login, password: values.password } };
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        const fields = getApiFieldErrors(data, tc);
        const knownFields = Object.fromEntries(
          Object.entries(fields).filter(([key]) =>
            ['username', 'email', 'password', 'password_confirmation'].includes(key),
          ),
        );
        setFieldErrors(knownFields);
        setError(
          Object.keys(knownFields).length
            ? tc('formReviewFields')
            : getApiErrorMessage({ ...data, status: response.status }, tc, 'apiErrorRequestFailed'),
        );
        return;
      }
      if (data.requires_totp) {
        setChallenge(data.challenge);
        return;
      }
      router.replace(setup ? '/welcome' : '/');
      router.refresh();
    } catch {
      setError(t('requestFailed'));
    } finally {
      setBusy(null);
    }
  }
  async function passkey() {
    setAttempt((value) => value + 1);
    setBusy('passkey');
    setError('');
    try {
      const options = await fetch('/api/v1/sessions/passkey-options', { method: 'POST' });
      if (!options.ok) throw new Error();
      const response = await startAuthentication({ optionsJSON: await options.json() });
      const result = await fetch('/api/v1/sessions/passkey-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      });
      if (!result.ok) throw new Error();
      router.replace('/');
      router.refresh();
    } catch {
      setError(t('passkeyFailed'));
      setAutofillAttempt((n) => n + 1);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="auth-form-panel">
      <div className="auth-form-heading">
        <h1>{t(setup ? 'setupTitle' : challenge ? 'verifyIdentity' : 'loginTitle')}</h1>
        {setup && <p>{t('setupIntro')}</p>}
        {challenge && <p>{t(recovery ? 'recoveryIntro' : 'verificationIntro')}</p>}
      </div>
      <form
        className="shelf-form auth-form"
        onSubmit={submit}
        aria-busy={!!busy}
        noValidate={setup}
        onChange={(event) => {
          const input = event.target as HTMLElement;
          if (!(input instanceof HTMLInputElement)) return;
          const name = input.name;
          if (!fieldErrors[name]) return;
          const remaining = { ...fieldErrors };
          delete remaining[name];
          setFieldErrors(remaining);
          if (!Object.keys(remaining).length) setError('');
        }}
      >
        {error && (
          <FormError message={error} key={attempt}>
            {Object.keys(fieldErrors).length > 0 && (
              <ul>
                {Object.entries(fieldErrors).map(([field, message]) => (
                  <li key={field}>
                    <a
                      href={`#auth-${field}`}
                      onClick={() => document.getElementById(`auth-${field}`)?.focus()}
                    >
                      {message}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </FormError>
        )}
        {challenge ? (
          <>
            <label>
              {t(recovery ? 'recoveryCode' : 'twoFactor')}
              <input
                name="code"
                required
                autoComplete="one-time-code"
                inputMode={recovery ? 'text' : 'numeric'}
                autoFocus
              />
            </label>
            <button className="text-button" type="button" onClick={() => setRecovery((v) => !v)}>
              {t(recovery ? 'useAuthenticator' : 'useRecoveryCode')}
            </button>
          </>
        ) : (
          <>
            {setup && (
              <>
                <div className="auth-field">
                  <label htmlFor="auth-username">{t('username')}</label>
                  <input
                    id="auth-username"
                    name="username"
                    autoComplete="username"
                    required
                    minLength={USERNAME_MIN}
                    maxLength={USERNAME_MAX}
                    aria-invalid={!!fieldErrors.username || undefined}
                    aria-describedby={fieldErrors.username ? 'auth-username-error' : undefined}
                  />
                  {fieldErrors.username && (
                    <span className="form-field-error" id="auth-username-error">
                      {fieldErrors.username}
                    </span>
                  )}
                </div>
              </>
            )}
            <div className="auth-field">
              <label htmlFor={setup ? 'auth-email' : 'auth-login'}>
                {t(setup ? 'email' : 'loginLabel')}
              </label>
              <div className={setup ? undefined : 'auth-login-input'}>
                {!setup && <UserRound size={16} aria-hidden="true" />}
                <input
                  id={setup ? 'auth-email' : 'auth-login'}
                  name={setup ? 'email' : 'login'}
                  type={setup ? 'email' : 'text'}
                  autoComplete={setup ? 'email' : 'username webauthn'}
                  required
                  aria-invalid={!!fieldErrors.email || undefined}
                  aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined}
                />
              </div>
              {fieldErrors.email && (
                <span className="form-field-error" id="auth-email-error">
                  {fieldErrors.email}
                </span>
              )}
            </div>
            {setup ? (
              <PasswordFields
                idPrefix="auth"
                passwordLabel={t('password')}
                confirmationLabel={t('confirmPassword')}
                errors={fieldErrors}
                disabled={!!busy}
                onValuesChange={() => {
                  const remaining = { ...fieldErrors };
                  delete remaining.password;
                  delete remaining.password_confirmation;
                  setFieldErrors(remaining);
                  if (!Object.keys(remaining).length) setError('');
                }}
              />
            ) : (
              <PasswordField
                id="auth-password"
                name="password"
                label={t('password')}
                autoComplete="current-password"
                disabled={!!busy}
                required
                error={fieldErrors.password}
                labelAction={
                  emailConfigured && !setup ? (
                    <Link className="text-button" href="/forgot-password">
                      {t('recoverPassword')}
                    </Link>
                  ) : undefined
                }
              />
            )}
          </>
        )}
        <button
          className="button primary-button auth-submit"
          disabled={!!busy}
          aria-busy={busy === 'password' || undefined}
        >
          {busy === 'password'
            ? t('working')
            : t(setup ? 'setupSubmit' : challenge ? 'verify' : 'loginSubmit')}
          {busy === 'password' ? <LoadingMark size={20} /> : <ArrowRight size={17} />}
        </button>
        {!setup && !challenge && (
          <>
            <div className="auth-divider" aria-hidden="true">
              <span>{tc('or')}</span>
            </div>
            <button
              className="button auth-passkey"
              type="button"
              disabled={!!busy}
              aria-busy={busy === 'passkey' || undefined}
              onClick={() => void passkey()}
            >
              {busy === 'passkey' ? <LoadingMark size={20} /> : <Fingerprint size={19} />}
              {t(busy === 'passkey' ? 'passkeyWaiting' : 'signInPasskey')}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
