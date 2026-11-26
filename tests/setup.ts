import { afterAll, beforeAll, vi } from 'vitest';
import { configure } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Dialogs and lists play short exit animations before they unmount. Under coverage on a busy CI
// runner, the default 1 s wait for them to disappear is occasionally too short.
configure({ asyncUtilTimeout: 3000 });

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://test_user:test_pass@localhost:5432/pixb_test?schema=public';

process.setMaxListeners(50);

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;
let consoleWarnSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeAll(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  consoleErrorSpy?.mockRestore();
  consoleWarnSpy?.mockRestore();
  consoleErrorSpy = null;
  consoleWarnSpy = null;
});
