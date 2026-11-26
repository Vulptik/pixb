import { describe, expect, it } from 'vitest';
import { parseBigInt } from '@/lib/utils/parseBigInt';

describe('parseBigInt', () => {
  it('parses valid bigint string', () => {
    expect(parseBigInt('123')).toBe(BigInt(123));
    expect(parseBigInt('0')).toBe(BigInt(0));
    expect(parseBigInt('9007199254740991')).toBe(BigInt(9007199254740991));
  });

  it('parses large bigint values', () => {
    const large = '123456789012345678901234567890';
    expect(parseBigInt(large)).toBe(BigInt(large));
  });

  it('parses negative bigint values', () => {
    expect(parseBigInt('-123')).toBe(BigInt(-123));
    expect(parseBigInt('-9007199254740991')).toBe(BigInt(-9007199254740991));
  });

  it('returns null for null input', () => {
    expect(parseBigInt(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(parseBigInt(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseBigInt('')).toBeNull();
  });

  it('returns null for invalid string', () => {
    expect(parseBigInt('abc')).toBeNull();
    expect(parseBigInt('12.34')).toBeNull();
    expect(parseBigInt('12a34')).toBeNull();
  });

  it('returns null for strings with spaces', () => {
    expect(parseBigInt('123 456')).toBeNull();
    // Note: BigInt constructor accepts strings with leading/trailing whitespace
    expect(parseBigInt(' 123')).toBe(BigInt(123));
    expect(parseBigInt('123 ')).toBe(BigInt(123));
  });

  it('returns null for special number strings', () => {
    expect(parseBigInt('NaN')).toBeNull();
    expect(parseBigInt('Infinity')).toBeNull();
    expect(parseBigInt('-Infinity')).toBeNull();
  });

  it('handles string with leading zeros', () => {
    expect(parseBigInt('0123')).toBe(BigInt(123));
    expect(parseBigInt('00000')).toBe(BigInt(0));
  });
});
