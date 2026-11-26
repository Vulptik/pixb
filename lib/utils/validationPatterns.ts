/**
 * Shared validation patterns for client-side forms.
 * Keep these aligned with server-side validations in lib/server.
 */

export const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_REGEX = new RegExp(
  String.raw`^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?~` +
    '`' +
    String.raw`])[A-Za-z\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?~` +
    '`' +
    String.raw`]{8,}$`,
);

const PASSWORD_SYMBOLS = String.raw`!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?~` + '`';
export const PASSWORD_SPECIAL_REGEX = new RegExp(`[${PASSWORD_SYMBOLS}]`);
export const PASSWORD_ALLOWED_REGEX = new RegExp(`^[A-Za-z\\d${PASSWORD_SYMBOLS}]+$`);

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 14;
export const PASSWORD_MIN = 8;
