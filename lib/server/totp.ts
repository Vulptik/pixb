import crypto from 'crypto';
import { TOTP, Secret } from 'otpauth';
import bcrypt from 'bcryptjs';
import { encrypt, decrypt } from './encryption';

const ISSUER = 'PixB';
const PERIOD = 30;
const DIGITS = 6;
const ALGORITHM = 'SHA1';
const WINDOW = 1;

export function generateTotpSecret(): string {
  const bytes = crypto.randomBytes(20);
  return new Secret({ buffer: new Uint8Array(bytes).buffer as ArrayBuffer }).base32;
}

export function generateTotpUri(username: string, secret: string): string {
  const totp = new TOTP({
    issuer: ISSUER,
    label: username,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secret),
  });
  return totp.toString();
}

export function verifyTotpToken(secret: string, token: string): boolean {
  const totp = new TOTP({
    issuer: ISSUER,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secret),
  });
  const delta = totp.validate({ token, window: WINDOW });
  return delta !== null;
}

export function encryptTotpSecret(secret: string): string {
  return encrypt(secret);
}

export function decryptTotpSecret(encrypted: string): string {
  return decrypt(encrypted);
}

export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const part1 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const part2 = crypto.randomBytes(2).toString('hex').toUpperCase();
    codes.push(`${part1}-${part2}`);
  }
  return codes;
}

export async function hashRecoveryCode(code: string): Promise<string> {
  return bcrypt.hash(code.replace('-', '').toUpperCase(), 10);
}

export async function verifyRecoveryCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code.replace('-', '').toUpperCase(), hash);
}
