'use client';
import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff, Lock, Shuffle } from 'lucide-react';
import PasswordStrengthIndicator from './PasswordStrengthIndicator';
import { generatePassword } from '@/lib/utils/password';
import { PASSWORD_MIN } from '@/lib/utils/validationPatterns';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: string;
  labelAction?: ReactNode;
  error?: string;
  confirmation?: boolean;
  showStrength?: boolean;
  onGenerate?: () => void;
};
export function PasswordField({
  label,
  labelAction,
  error,
  confirmation = false,
  showStrength = false,
  onGenerate,
  id,
  onChange,
  ...props
}: Props) {
  const t = useTranslations('common');
  const autoId = useId(),
    inputId = id || autoId;
  const [visible, setVisible] = useState(false),
    [typed, setTyped] = useState('');
  const helpId = `${inputId}-help`,
    errorId = `${inputId}-error`;
  return (
    <div className="auth-field password-field">
      <div className="auth-label-row">
        <label htmlFor={inputId}>{label}</label>
        {labelAction}
      </div>
      <div className="auth-password" data-invalid={error ? 'true' : undefined}>
        <Lock size={16} className="password-field-lock" aria-hidden="true" />
        <input
          {...props}
          id={inputId}
          type={visible ? 'text' : 'password'}
          onChange={(event) => {
            setTyped(event.currentTarget.value);
            onChange?.(event);
          }}
          aria-invalid={error ? true : props['aria-invalid']}
          aria-describedby={
            [props['aria-describedby'], showStrength ? helpId : '', error ? errorId : '']
              .filter(Boolean)
              .join(' ') || undefined
          }
        />
        {onGenerate && (
          <button
            type="button"
            className="auth-password-toggle"
            aria-label={t('generate')}
            aria-controls={inputId}
            disabled={props.disabled || props.readOnly}
            onClick={onGenerate}
          >
            <Shuffle size={17} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="auth-password-toggle"
          aria-controls={inputId}
          aria-pressed={visible}
          disabled={props.disabled}
          aria-label={t(
            confirmation
              ? visible
                ? 'hidePasswordConfirmation'
                : 'showPasswordConfirmation'
              : visible
                ? 'hidePassword'
                : 'showPassword',
          )}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
      {showStrength && (
        <div id={helpId}>
          <PasswordStrengthIndicator password={String(props.value ?? typed)} showRequirements />
        </div>
      )}
      {error && (
        <p className="form-field-error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

type PasswordValues = { password: string; password_confirmation: string };
type PasswordFieldsProps = {
  idPrefix: string;
  passwordLabel: string;
  confirmationLabel: string;
  confirmationAriaLabel?: string;
  values?: PasswordValues;
  onValuesChange?: (values: PasswordValues) => void;
  errors?: Partial<PasswordValues>;
  disabled?: boolean;
  required?: boolean;
};

/** Shared new-password pair for setup, account management, and recovery. */
export function PasswordFields({
  idPrefix,
  passwordLabel,
  confirmationLabel,
  confirmationAriaLabel,
  values,
  onValuesChange,
  errors,
  disabled,
  required = true,
}: PasswordFieldsProps) {
  const [localValues, setLocalValues] = useState<PasswordValues>({
    password: '',
    password_confirmation: '',
  });
  const current = values ?? localValues;
  const change = (next: PasswordValues) => {
    setLocalValues(next);
    onValuesChange?.(next);
  };
  return (
    <>
      <PasswordField
        id={`${idPrefix}-password`}
        name="password"
        label={passwordLabel}
        autoComplete="new-password"
        minLength={PASSWORD_MIN}
        required={required}
        disabled={disabled}
        value={current.password}
        error={errors?.password}
        showStrength
        onChange={(event) => change({ ...current, password: event.target.value })}
        onGenerate={() => {
          const password = generatePassword();
          change({ password, password_confirmation: password });
        }}
      />
      <PasswordField
        id={`${idPrefix}-password_confirmation`}
        name="password_confirmation"
        label={confirmationLabel}
        aria-label={confirmationAriaLabel}
        autoComplete="new-password"
        required={required}
        disabled={disabled}
        confirmation
        value={current.password_confirmation}
        error={errors?.password_confirmation}
        onChange={(event) => change({ ...current, password_confirmation: event.target.value })}
      />
    </>
  );
}
