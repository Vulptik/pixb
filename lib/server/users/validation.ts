import { parseRoleValue } from '@/lib/server/roles';

const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
const PASSWORD_REGEX = new RegExp(
  String.raw`^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?~` +
    '`' +
    String.raw`])[A-Za-z\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?~` +
    '`' +
    String.raw`]{8,}$`,
);

export type UserInput = {
  username?: string;
  email?: string;
  password?: string;
  password_confirmation?: string;
  role?: number | string;
  quota?: number;
};

const ALLOWED_ROLES = new Set([0, 1]);

export function validateUserCreate(input: UserInput) {
  const errors: Record<string, string[]> = {};

  if (
    !input.username ||
    input.username.length < 3 ||
    input.username.length > 14 ||
    !USERNAME_REGEX.test(input.username)
  ) {
    errors.username = ['is invalid'];
  }

  if (!input.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    errors.email = ['is invalid'];
  }

  if (!input.password || !PASSWORD_REGEX.test(input.password)) {
    errors.password = ['is invalid'];
  }

  if (!input.password_confirmation || input.password_confirmation !== input.password) {
    errors.password_confirmation = ['does not match'];
  }

  if (
    input.quota !== undefined &&
    (!Number.isInteger(input.quota) || input.quota < 0 || input.quota > 2147483647)
  ) {
    errors.quota = ['must be a non-negative whole number no greater than 2147483647'];
  }

  if (input.role !== undefined) {
    const parsedRole = parseRoleValue(input.role);
    if (parsedRole === null || !ALLOWED_ROLES.has(parsedRole)) {
      errors.role = ['is invalid'];
    }
  }

  return errors;
}

export function validateUserUpdate(input: UserInput) {
  const errors: Record<string, string[]> = {};

  if (
    input.username &&
    (input.username.length < 3 ||
      input.username.length > 14 ||
      !USERNAME_REGEX.test(input.username))
  ) {
    errors.username = ['is invalid'];
  }

  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    errors.email = ['is invalid'];
  }

  if (input.password) {
    if (!PASSWORD_REGEX.test(input.password)) {
      errors.password = ['is invalid'];
    }
    if (!input.password_confirmation || input.password_confirmation !== input.password) {
      errors.password_confirmation = ['does not match'];
    }
  }

  if (
    input.quota !== undefined &&
    (!Number.isInteger(input.quota) || input.quota < 0 || input.quota > 2147483647)
  ) {
    errors.quota = ['must be a non-negative whole number no greater than 2147483647'];
  }

  if (input.role !== undefined) {
    const parsedRole = parseRoleValue(input.role);
    if (parsedRole === null || !ALLOWED_ROLES.has(parsedRole)) {
      errors.role = ['is invalid'];
    }
  }

  return errors;
}
