import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRateLimit, rateLimitResponse, getClientIp } from '@/lib/server/rateLimit';

describe('rateLimit helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkRateLimit', () => {
    it('allows first request', () => {
      const result = checkRateLimit('test-key-1');
      expect(result).toBe(true);
    });

    it('allows requests under limit', () => {
      const key = 'test-key-2';
      expect(checkRateLimit(key, { maxAttempts: 5 })).toBe(true);
      expect(checkRateLimit(key, { maxAttempts: 5 })).toBe(true);
      expect(checkRateLimit(key, { maxAttempts: 5 })).toBe(true);
      expect(checkRateLimit(key, { maxAttempts: 5 })).toBe(true);
      expect(checkRateLimit(key, { maxAttempts: 5 })).toBe(true);
    });

    it('blocks requests after exceeding limit', () => {
      const key = 'test-key-3';
      for (let i = 0; i < 5; i++) {
        expect(checkRateLimit(key, { maxAttempts: 5 })).toBe(true);
      }
      expect(checkRateLimit(key, { maxAttempts: 5 })).toBe(false);
      expect(checkRateLimit(key, { maxAttempts: 5 })).toBe(false);
    });

    it('uses default maxAttempts of 5', () => {
      const key = 'test-key-4';
      for (let i = 0; i < 5; i++) {
        expect(checkRateLimit(key)).toBe(true);
      }
      expect(checkRateLimit(key)).toBe(false);
    });

    it('resets after window expires', async () => {
      const key = 'test-key-5';
      const windowMs = 100;

      for (let i = 0; i < 5; i++) {
        expect(checkRateLimit(key, { maxAttempts: 5, windowMs })).toBe(true);
      }
      expect(checkRateLimit(key, { maxAttempts: 5, windowMs })).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, windowMs + 10));

      expect(checkRateLimit(key, { maxAttempts: 5, windowMs })).toBe(true);
    });

    it('tracks different keys independently', () => {
      expect(checkRateLimit('key-a', { maxAttempts: 2 })).toBe(true);
      expect(checkRateLimit('key-b', { maxAttempts: 2 })).toBe(true);
      expect(checkRateLimit('key-a', { maxAttempts: 2 })).toBe(true);
      expect(checkRateLimit('key-b', { maxAttempts: 2 })).toBe(true);

      expect(checkRateLimit('key-a', { maxAttempts: 2 })).toBe(false);
      expect(checkRateLimit('key-b', { maxAttempts: 2 })).toBe(false);
    });

    it('uses default windowMs of 15 minutes', () => {
      const key = 'test-key-6';
      expect(checkRateLimit(key)).toBe(true);
    });

    it('handles custom maxAttempts', () => {
      const key = 'test-key-7';
      expect(checkRateLimit(key, { maxAttempts: 2 })).toBe(true);
      expect(checkRateLimit(key, { maxAttempts: 2 })).toBe(true);
      expect(checkRateLimit(key, { maxAttempts: 2 })).toBe(false);
    });
  });

  describe('rateLimitResponse', () => {
    it('returns 429 status', async () => {
      const response = rateLimitResponse();
      expect(response.status).toBe(429);
      const body = await response.json();
      expect(body.message).toBe('Too many requests. Please try again later.');
    });
  });

  describe('getClientIp', () => {
    it('extracts IP from x-forwarded-for header', () => {
      const request = new Request('http://localhost', {
        headers: {
          'x-forwarded-for': '192.168.1.1, 10.0.0.1',
        },
      });
      expect(getClientIp(request)).toBe('192.168.1.1');
    });

    it('extracts IP from x-real-ip header when x-forwarded-for not present', () => {
      const request = new Request('http://localhost', {
        headers: {
          'x-real-ip': '192.168.1.2',
        },
      });
      expect(getClientIp(request)).toBe('192.168.1.2');
    });

    it('prioritizes x-forwarded-for over x-real-ip', () => {
      const request = new Request('http://localhost', {
        headers: {
          'x-forwarded-for': '192.168.1.1',
          'x-real-ip': '192.168.1.2',
        },
      });
      expect(getClientIp(request)).toBe('192.168.1.1');
    });

    it('returns "unknown" when no IP headers present', () => {
      const request = new Request('http://localhost');
      expect(getClientIp(request)).toBe('unknown');
    });

    it('handles single IP in x-forwarded-for', () => {
      const request = new Request('http://localhost', {
        headers: {
          'x-forwarded-for': '192.168.1.1',
        },
      });
      expect(getClientIp(request)).toBe('192.168.1.1');
    });

    it('trims whitespace from IP', () => {
      const request = new Request('http://localhost', {
        headers: {
          'x-forwarded-for': '  192.168.1.1  , 10.0.0.1',
        },
      });
      expect(getClientIp(request)).toBe('192.168.1.1');
    });
  });
});
