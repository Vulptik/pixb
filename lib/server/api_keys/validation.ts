export type ApiKeyInput = {
  name?: string;
  description?: string;
  expiration?: number | string;
  scopes?: unknown;
};

function parseExpiration(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim().length === 0) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
  return parsed;
}

export function validateApiKeyCreate(input: ApiKeyInput) {
  const errors: Record<string, string[]> = {};

  if (!input.name || input.name.trim().length === 0) {
    errors.name = ['is required'];
  } else if (input.name.length > 20) {
    errors.name = ['is too long'];
  }

  if (input.description && input.description.length > 80) {
    errors.description = ['is too long'];
  }

  const expiration = parseExpiration(input.expiration);
  if (expiration === null) {
    errors.expiration = ['is required'];
  } else if (expiration < 0 || expiration > 4) {
    errors.expiration = ['is invalid'];
  }

  if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
    errors.scopes = ['is required'];
  } else if (!input.scopes.every((scope) => ['read', 'write', 'delete'].includes(scope))) {
    errors.scopes = ['is invalid'];
  }

  return errors;
}
