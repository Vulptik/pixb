export type UserRole = 'user' | 'admin';

export const ROLE_VALUES: Record<UserRole, number> = {
  user: 0,
  admin: 1,
};

export function parseRoleValue(input: unknown): number | null {
  if (input === undefined || input === null) return null;
  if (typeof input === 'number' && Number.isInteger(input)) {
    return input;
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed in ROLE_VALUES) {
      return ROLE_VALUES[trimmed as UserRole];
    }
    const parsed = Number(trimmed);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }
  return null;
}

export function roleToString(roleValue: number): UserRole {
  if (roleValue === 1) return 'admin';
  return 'user';
}

export function isAdmin(roleValue: number): boolean {
  return roleValue === 1;
}
