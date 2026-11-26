import {
  EMAIL_REGEX,
  PASSWORD_ALLOWED_REGEX,
  PASSWORD_MIN,
  PASSWORD_REGEX,
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_REGEX,
} from './validationPatterns';
type Translator = (key: string, values?: Record<string, string | number>) => string;
export function validateNewPassword(
  password: string,
  confirmation: string,
  t: Translator,
  requireComplexity = true,
) {
  const errors: Record<string, string> = {};
  if (!password) errors.password = t('passwordRequired');
  else if (password.length < PASSWORD_MIN)
    errors.password = t('passwordMin', { min: PASSWORD_MIN });
  else if (requireComplexity && !PASSWORD_ALLOWED_REGEX.test(password))
    errors.password = t('passwordCharacters');
  else if (requireComplexity && !PASSWORD_REGEX.test(password))
    errors.password = t('passwordFormat', { min: PASSWORD_MIN });
  if (!confirmation) errors.password_confirmation = t('passwordConfirmRequired');
  else if (password !== confirmation) errors.password_confirmation = t('passwordsMustMatch');
  return errors;
}
export function validateAccountForm(
  values: Record<string, unknown>,
  t: Translator,
  passwordRequired = true,
) {
  const value = (key: string) => (typeof values[key] === 'string' ? (values[key] as string) : '');
  const username = value('username'),
    email = value('email');
  const errors: Record<string, string> = {};
  if (!username) errors.username = t('usernameRequired');
  else if (username.length < USERNAME_MIN)
    errors.username = t('usernameMin', { min: USERNAME_MIN });
  else if (username.length > USERNAME_MAX)
    errors.username = t('usernameMax', { max: USERNAME_MAX });
  else if (!USERNAME_REGEX.test(username)) errors.username = t('usernameFormat');
  if (!email) errors.email = t('emailRequired');
  else if (!EMAIL_REGEX.test(email)) errors.email = t('invalidEmail');
  if (passwordRequired || value('password') || value('password_confirmation'))
    Object.assign(
      errors,
      validateNewPassword(value('password'), value('password_confirmation'), t),
    );
  return errors;
}
