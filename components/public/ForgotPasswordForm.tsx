'use client';

import { useState, FC, JSX } from 'react';
import Link from 'next/link';
import { Button, Alert } from '@/components/ui/primitives';
import { Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Card from '@/components/ui/Card';
import EnhancedInput from '@/components/ui/EnhancedInput';
import { FormError } from '@/components/ui/FormError';
import { EMAIL_REGEX } from '@/lib/utils/validationPatterns';

const ForgotPasswordForm: FC = (): JSX.Element => {
  const t = useTranslations('forgotPassword');
  const tc = useTranslations('common'),
    tv = useTranslations('validation');

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [attempt, setAttempt] = useState(0);

  const handleSubmit = async () => {
    setAttempt((value) => value + 1);
    setError('');
    const issue = !email.trim()
      ? tv('emailRequired')
      : !EMAIL_REGEX.test(email.trim())
        ? tv('invalidEmail')
        : '';
    setFieldError(issue);
    if (issue) {
      setError(tc('formReviewFields'));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/password-resets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (res.ok) {
        setSent(true);
      } else {
        setError(t('failed'));
      }
    } catch {
      setError(t('failed'));
    }
    setSubmitting(false);
  };

  return (
    <div className="w-full">
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h1 className="font-semibold text-xl text-foreground">{t('title')}</h1>
        </div>

        <Card className="p-6">
          <div className="space-y-5">
            {sent ? (
              <Alert variant="solid" color="success">
                {t('sent')}
              </Alert>
            ) : (
              <>
                {error && <FormError message={error} key={attempt} />}

                <p className="text-foreground/50 text-sm text-center">{t('description')}</p>

                <EnhancedInput
                  size="lg"
                  placeholder={t('email')}
                  aria-label={t('email')}
                  type="email"
                  value={email}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setEmail(e.target.value);
                    setFieldError('');
                    setError('');
                  }}
                  isInvalid={!!fieldError}
                  errorMessage={fieldError}
                  startContent={<Mail size={16} />}
                  autoFocus
                />

                <Button
                  color="primary"
                  fullWidth
                  size="lg"
                  isLoading={submitting}
                  isDisabled={submitting}
                  onPress={handleSubmit}
                >
                  {submitting ? t('sending') : t('sendResetLink')}
                </Button>
              </>
            )}

            <div className="text-center">
              <Link href="/login" className="text-sm text-primary hover:underline">
                {t('backToLogin')}
              </Link>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default ForgotPasswordForm;
