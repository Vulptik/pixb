import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: `${dirname}/`,
      },
      {
        find: /^lib\//,
        replacement: `${dirname}/lib/`,
      },
    ],
  },
  test: {
    // Exercise the real TUS metadata conversion while mocking only its HTTP transport.
    server: { deps: { inline: ['@uppy/tus'] } },
    environment: 'node',
    globals: true,
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/.next/**', '**/out/**', '**/build/**', '**/coverage/**', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
      include: [
        'app/**/*.{ts,tsx}',
        'components/**/*.{ts,tsx}',
        'i18n/**/*.{ts,tsx}',
        'instrumentation.ts',
        'lib/**/*.{ts,tsx}',
        'proxy.ts',
      ],
      exclude: [
        '**/*.d.ts',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        '**/node_modules/**',
        '**/.next/**',
        '**/prisma/**',
        '**/scripts/**',
        '**/tests/**',
        '**/types/**',
        'types.ts',
        'types/*.ts',
        'css.d.ts',
        'app/**/loading.tsx',
        'app/**/error.tsx',
        'app/**/layout.tsx',
        'lib/server/fileProxy.ts',
        'lib/server/instance.ts',
        'lib/server/logger.ts',
        'lib/server/medias/storage.ts',
        'lib/server/rateLimit.ts',
        'lib/server/storagePaths.ts',
        'lib/server/avatars/serve.ts',
      ],
    },
  },
});
