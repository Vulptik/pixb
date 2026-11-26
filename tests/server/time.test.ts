import { describe, expect, it } from 'vitest';

import { timeDistance } from '@/lib/server/time';

describe('time helpers', () => {
  it('formats time distance without in/ago', () => {
    const now = new Date('2025-01-01T00:00:00Z');
    const future = new Date('2025-01-01T00:01:00Z');
    const past = new Date('2024-12-31T23:59:00Z');

    expect(timeDistance(future, now)).toBe('1 minute');
    expect(timeDistance(past, now)).toBe('1 minute');
  });
});
