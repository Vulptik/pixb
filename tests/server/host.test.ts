import { describe, expect, it } from 'vitest';
import { isIpAddress, isLocalHostname, getCookieDomain } from '@/lib/server/host';

describe('host helpers', () => {
  describe('isIpAddress', () => {
    it('detects valid IPv4 addresses', () => {
      expect(isIpAddress('192.168.1.1')).toBe(true);
      expect(isIpAddress('10.0.0.1')).toBe(true);
      expect(isIpAddress('127.0.0.1')).toBe(true);
      expect(isIpAddress('255.255.255.255')).toBe(true);
      expect(isIpAddress('0.0.0.0')).toBe(true);
    });

    it('detects IPv6 addresses', () => {
      expect(isIpAddress('::1')).toBe(true);
      expect(isIpAddress('2001:db8::1')).toBe(true);
      expect(isIpAddress('fe80::1')).toBe(true);
    });

    it('rejects invalid IP addresses', () => {
      expect(isIpAddress('256.1.1.1')).toBe(false);
      expect(isIpAddress('192.168.1')).toBe(false);
      expect(isIpAddress('example.com')).toBe(false);
      expect(isIpAddress('localhost')).toBe(false);
    });
  });

  describe('isLocalHostname', () => {
    it('identifies localhost variations', () => {
      expect(isLocalHostname('localhost')).toBe(true);
      expect(isLocalHostname('::1')).toBe(true);
      expect(isLocalHostname('')).toBe(true);
    });

    it('identifies private IPv4 addresses', () => {
      expect(isLocalHostname('10.0.0.1')).toBe(true);
      expect(isLocalHostname('172.16.0.1')).toBe(true);
      expect(isLocalHostname('172.31.255.255')).toBe(true);
      expect(isLocalHostname('192.168.1.1')).toBe(true);
      expect(isLocalHostname('127.0.0.1')).toBe(true);
    });

    it('identifies single-label hostnames', () => {
      expect(isLocalHostname('container')).toBe(true);
      expect(isLocalHostname('k8s-service')).toBe(true);
    });

    it('rejects public hostnames', () => {
      expect(isLocalHostname('example.com')).toBe(false);
      expect(isLocalHostname('sub.example.com')).toBe(false);
      expect(isLocalHostname('8.8.8.8')).toBe(false);
    });
  });

  describe('getCookieDomain', () => {
    it('returns domain with dot prefix for public hostnames', () => {
      expect(getCookieDomain('example.com')).toBe('.example.com');
      expect(getCookieDomain('sub.example.com')).toBe('.sub.example.com');
    });

    it('returns undefined for IP addresses', () => {
      expect(getCookieDomain('192.168.1.1')).toBeUndefined();
      expect(getCookieDomain('127.0.0.1')).toBeUndefined();
      expect(getCookieDomain('::1')).toBeUndefined();
    });

    it('returns undefined for local hostnames', () => {
      expect(getCookieDomain('localhost')).toBeUndefined();
      expect(getCookieDomain('container')).toBeUndefined();
    });

    it('handles hostnames with port numbers', () => {
      expect(getCookieDomain('example.com:3000')).toBe('.example.com');
      expect(getCookieDomain('localhost:3000')).toBeUndefined();
    });

    it('handles IPv6 in brackets', () => {
      expect(getCookieDomain('[::1]:3000')).toBeUndefined();
      expect(getCookieDomain('[2001:db8::1]:8080')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(getCookieDomain('')).toBeUndefined();
    });
  });
});
