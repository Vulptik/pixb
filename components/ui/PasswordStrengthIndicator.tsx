'use client';
import { useTranslations } from 'next-intl';
import { Check, Circle } from 'lucide-react';
import type { PasswordStrengthIndicatorProps } from '@/types';
import {
  PASSWORD_ALLOWED_REGEX,
  PASSWORD_MIN,
  PASSWORD_SPECIAL_REGEX,
} from '@/lib/utils/validationPatterns';

export default function PasswordStrengthIndicator({
  password,
  className = '',
  passwordRules,
  showRequirements = false,
}: PasswordStrengthIndicatorProps) {
  const t = useTranslations('common');
  const rules = passwordRules || {};
  const minimum = rules.minimum ?? PASSWORD_MIN;
  const checks = [
    { key: 'passwordRuleLength', met: password.length >= minimum, enabled: true },
    {
      key: 'passwordRuleLowercase',
      met: /[a-z]/.test(password),
      enabled: rules.lowercase !== false,
    },
    {
      key: 'passwordRuleUppercase',
      met: /[A-Z]/.test(password),
      enabled: rules.uppercase !== false,
    },
    { key: 'passwordRuleNumber', met: /\d/.test(password), enabled: rules.number !== false },
    {
      key: 'passwordRuleSymbol',
      met: PASSWORD_SPECIAL_REGEX.test(password),
      enabled: rules.special !== false,
    },
  ].filter((item) => item.enabled);
  const charactersAllowed = !password || PASSWORD_ALLOWED_REGEX.test(password);
  if (!charactersAllowed) checks.push({ key: 'passwordRuleCharacters', met: false, enabled: true });
  const met = checks.filter((item) => item.met).length;
  const level = !password
    ? 'empty'
    : met === checks.length
      ? 'complete'
      : met / checks.length >= 0.5
        ? 'partial'
        : 'weak';
  return (
    <div className={`password-strength ${className}`} data-level={level}>
      <div
        className="password-strength-bars"
        role="meter"
        aria-label={t('passwordStrength')}
        aria-valuemin={0}
        aria-valuemax={checks.length}
        aria-valuenow={password ? met : 0}
        aria-valuetext={t('passwordRequirementsProgress', {
          met: password ? met : 0,
          total: checks.length,
        })}
      >
        {Array.from({ length: 4 }, (_, index) => (
          <span
            key={index}
            data-active={!!password && index < Math.floor((met / checks.length) * 4)}
          />
        ))}
      </div>
      {showRequirements && (
        <ul className="password-requirements">
          {checks.map(({ key, met }) => (
            <li key={key} data-met={met}>
              {met ? (
                <Check size={13} aria-hidden="true" />
              ) : (
                <Circle size={10} aria-hidden="true" />
              )}
              {t(key, { min: minimum })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
