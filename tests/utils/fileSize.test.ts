import { describe, expect, it } from 'vitest';
import { formatFileSize } from '@/lib/utils/fileSize';

describe('file size metadata', () => {
  it.each([
    ['0', '0B'],
    ['100', '100B'],
    ['1024', '1 kB'],
    ['1536', '1.5 kB'],
    ['2097152', '2 MB'],
    ['1073741824', '1 GB'],
    ['1099511627776', '1 TB'],
  ])('formats %s bytes as %s', (bytes, expected) => {
    expect(formatFileSize(bytes, 'en')).toBe(expected);
  });
  it('localizes the number and unit for French', () => {
    expect(formatFileSize(1572864, 'fr')).toMatch(/^1,5\sMo$/);
  });
});
