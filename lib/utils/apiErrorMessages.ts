import { PASSWORD_MIN, USERNAME_MIN, USERNAME_MAX } from './validationPatterns';

type Translator = ((key: string, values?: Record<string, string | number>) => string) & {
  has?: (key: string) => boolean;
};

const MESSAGE_KEY_MAP: Record<string, string> = {
  unauthorized: 'apiErrorUnauthorized',
  forbidden: 'apiErrorForbidden',
  'validation failed': 'apiErrorValidationFailed',
  'not found': 'apiErrorNotFound',
  'not found.': 'apiErrorNotFound',
  'invalid credentials': 'apiErrorInvalidCredentials',
  'invalid credentials.': 'apiErrorInvalidCredentials',
  'invalid or expired token.': 'apiErrorResetLinkExpired',
  'recovery mode is not available.': 'apiErrorRecoveryUnavailable',
  'no admin account found.': 'apiErrorNoAdminAccount',
  'too many requests. please try again later.': 'apiErrorTooManyRequests',
  'request timeout': 'apiErrorRequestTimeout',
  'cannot delete the last user.': 'apiErrorCannotDeleteLastUser',
  'cannot delete the last admin.': 'apiErrorCannotDeleteLastAdmin',
  'public signups are disabled.': 'apiErrorSignupsDisabled',
};

const STATUS_KEY_MAP: Record<number, string> = {
  401: 'apiErrorUnauthorized',
  403: 'apiErrorForbidden',
  404: 'apiErrorNotFound',
  422: 'apiErrorValidationFailed',
  429: 'apiErrorTooManyRequests',
};

const ERROR_KEY_MAP: Record<string, string> = {
  'is required': 'required',
  'is invalid': 'invalid',
  'invalid format': 'invalidFormat',
  'has already been taken': 'alreadyTaken',
  'does not match': 'doesNotMatch',
  'is too long': 'tooLong',
  'is too short': 'tooShort',
  'cannot be replaced': 'cannotBeReplaced',
  'must be greater than or equal to 1': 'minOne',
  taken_in_parent: 'takenInParent',
  'only text files can be edited': 'onlyTextEditable',
  'file path not found': 'filePathNotFound',
};

const normalizeMessage = (message: string): string => message.trim().toLowerCase();

export const getApiErrorMessage = (
  error: unknown,
  tCommon: Translator,
  fallbackKey: string = 'unknownError',
): string => {
  if (!error) return tCommon(fallbackKey);

  if (typeof error === 'string') {
    const normalized = normalizeMessage(error);
    const mappedKey = MESSAGE_KEY_MAP[normalized];
    if (mappedKey) return tCommon(mappedKey);
    if (normalized.includes('too many requests')) return tCommon('apiErrorTooManyRequests');
    return tCommon(fallbackKey);
  }
  if (typeof error !== 'object') return tCommon(fallbackKey);

  const fields = getApiFieldErrors(error, tCommon);
  if (Object.keys(fields).length) return [...new Set(Object.values(fields))].join(' ');

  const message = 'message' in error && typeof error.message === 'string' ? error.message : '';
  const status = 'status' in error && typeof error.status === 'number' ? error.status : undefined;

  if (message) {
    const normalized = normalizeMessage(message);
    const mappedKey = MESSAGE_KEY_MAP[normalized];
    if (mappedKey) return tCommon(mappedKey);
    if (normalized.includes('too many requests')) return tCommon('apiErrorTooManyRequests');
  }

  if (status && STATUS_KEY_MAP[status]) {
    return tCommon(STATUS_KEY_MAP[status]);
  }

  return tCommon(fallbackKey);
};

export const getApiFieldErrorMessage = (
  field: string,
  message: string,
  tCommon: Translator,
): string => {
  const normalized = normalizeMessage(message);
  const errorKey = ERROR_KEY_MAP[normalized];
  if (errorKey) {
    const i18nKey = `fieldValidation.${field}.${errorKey}`;
    if (!tCommon.has || tCommon.has(i18nKey))
      return tCommon(i18nKey, {
        min: field === 'username' ? USERNAME_MIN : PASSWORD_MIN,
        max: USERNAME_MAX,
      });
  }
  return tCommon('fieldValueInvalid');
};

export function getApiFieldErrors(error: unknown, tCommon: Translator): Record<string, string> {
  if (
    !error ||
    typeof error !== 'object' ||
    !('items' in error) ||
    !error.items ||
    typeof error.items !== 'object' ||
    Array.isArray(error.items)
  )
    return {};
  const fields: Record<string, string> = {};
  for (const [field, value] of Object.entries(error.items)) {
    const messages =
      typeof value === 'string'
        ? [value]
        : Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string')
          : [];
    if (messages.length) fields[field] = getApiFieldErrorMessage(field, messages[0], tCommon);
  }
  return fields;
}
