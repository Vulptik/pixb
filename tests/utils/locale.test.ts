import { expect, it } from 'vitest';
import { resolveLocale } from '@/i18n/locale';

it.each([
  ['fr', 'en-US,en;q=0.9', 'fr'],
  ['en', 'fr-FR', 'en'],
  [undefined, 'fr-CA,fr;q=0.9,en;q=0.8', 'fr'],
  [undefined, 'fr;q=0.2,en;q=0.9', 'en'],
  [undefined, 'fr;q=0,en;q=0.5', 'en'],
  [undefined, 'fr;q=invalid,en;q=0.8', 'en'],
  [undefined, 'fr;q=2,en;q=0.8', 'en'],
  [undefined, 'FR-fr;Q=0.9,en;q=0.8', 'fr'],
  [undefined, 'es-MX,fr;q=0.8', 'fr'],
  ['de', 'fr-FR', 'fr'],
  ['es', null, 'en'],
  ['it', 'it-IT,de;q=0.8', 'en'],
  [undefined, 'fr;q=0.8,en;q=0.8', 'fr'],
  ['unknown', 'fr-FR', 'fr'],
  [undefined, 'ja-JP,ko;q=0.5', 'en'],
  [undefined, null, 'en'],
] as const)(
  'resolves preference %s and browser languages %s to %s',
  (preference, header, expected) => {
    expect(resolveLocale(preference, header)).toBe(expected);
  },
);
