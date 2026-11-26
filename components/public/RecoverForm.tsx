'use client';

import { useState, useEffect, FC, JSX } from 'react';
import Link from 'next/link';
import { Button, Alert } from '@/components/ui/primitives';
import { useTranslations } from 'next-intl';
import Card from '@/components/ui/Card';
import { PasswordFields } from '@/components/ui/PasswordField';
import { validateNewPassword } from '@/lib/utils/accountValidation';
import { FormError } from '@/components/ui/FormError';
import { getApiErrorMessage } from '@/lib/utils/apiErrorMessages';

const RecoverForm: FC = (): JSX.Element => {
  const t = useTranslations('recover');
  const tc = useTranslations('common'),
    tv = useTranslations('validation');

  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [success, setSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});

  useEffect(() => {
    const checkAvailability = async () => {
      try {
        const res = await fetch('/api/v1/recover', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setAvailable(data.available);
        }
      } catch {
        // ignore
      }
      setLoading(false);
    };
    void checkAvailability();
  }, []);

  const handleSubmit = async () => {
    setAttempt((value) => value + 1);
    setFieldErrors({});
    setError('');

    const issues = validateNewPassword(password, confirmPassword, tv, false);
    const errors = { password: issues.password, confirm: issues.password_confirmation };
    if (errors.password || errors.confirm) {
      setFieldErrors(errors);
      setError(tc('formReviewFields'));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        setSuccess(true);
      } else {
        const data = await res.json().catch(() => null);
        setError(getApiErrorMessage({ ...data, status: res.status }, tc, 'apiErrorRequestFailed'));
      }
    } catch {
      setError(t('failed'));
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="w-full">
        <div className="text-center">
          <h1 className="font-semibold text-xl text-foreground">{t('title')}</h1>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="w-full">
        <div className="space-y-6">
          <div className="text-center">
            <h1 className="font-semibold text-xl text-foreground">{t('title')}</h1>
          </div>
          <Card className="p-6">
            <div className="space-y-4 text-center">
              <Alert variant="solid" color="success">
                {t('success')}
              </Alert>
              <Link href="/login">
                <Button color="primary" fullWidth size="lg">
                  {t('goToLogin')}
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="font-semibold text-xl text-foreground">{t('title')}</h1>
        </div>

        <Card className="p-6">
          <div className="space-y-5">
            {!available ? (
              <Alert variant="solid" color="warning">
                {t('notAvailable')}
              </Alert>
            ) : (
              <>
                {error && <FormError message={error} key={attempt} />}

                <p className="text-foreground/50 text-sm text-center">{t('description')}</p>

                <PasswordFields
                  idPrefix="recovery"
                  passwordLabel={t('newPassword')}
                  confirmationLabel={t('confirmPassword')}
                  values={{ password, password_confirmation: confirmPassword }}
                  onValuesChange={(next) => {
                    setPassword(next.password);
                    setConfirmPassword(next.password_confirmation);
                    setFieldErrors({});
                  }}
                  errors={{
                    password: fieldErrors.password,
                    password_confirmation: fieldErrors.confirm,
                  }}
                  disabled={submitting}
                />

                <Button
                  color="primary"
                  fullWidth
                  size="lg"
                  isLoading={submitting}
                  isDisabled={submitting}
                  onPress={handleSubmit}
                >
                  {submitting ? t('resetting') : t('resetPassword')}
                </Button>
              </>
            )}

            <div className="text-center">
              <Link href="/login" className="text-sm text-primary hover:underline">
                {t('goToLogin')}
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default RecoverForm;
