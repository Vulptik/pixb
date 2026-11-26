import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';

function keys(value: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === 'string'
      ? [prefix + key]
      : keys(child as Record<string, unknown>, `${prefix}${key}.`),
  );
}

it('keeps English and French translation keys in sync', () => {
  expect(keys(en).sort()).toEqual(keys(fr).sort());
});

describe.each([
  ['en', en, 'file', 'files'],
  ['fr', fr, 'fichier', 'fichiers'],
] as const)('%s interface copy', (locale, messages, singular, plural) => {
  const t = createTranslator({
    locale,
    messages,
    namespace: 'shelf',
    onError: (error) => {
      throw error;
    },
  });
  it('uses helpful zero labels and correct singular and plural counts', () => {
    for (const key of ['count', 'collectionFileCount'] as const) {
      expect(t(key, { count: 0 })).not.toMatch(/\d/);
      expect(t(key, { count: 1 })).toBe(`1 ${singular}`);
      expect(t(key, { count: 2 })).toBe(`2 ${plural}`);
    }
    expect(t('collectionCount', { count: 0 })).not.toMatch(/\d/);
  });
  it('matches deletion titles, buttons and notifications to one or several files', () => {
    expect(t('confirmDelete', { count: 1 })).not.toBe(t('confirmDelete', { count: 2 }));
    expect(t('confirmDelete', { count: 2 })).toContain('2');
    expect(t('deleteFiles', { count: 1 })).not.toBe(t('deleteFiles', { count: 2 }));
    expect(t('removed', { count: 2 })).toContain(`2 ${plural}`);
    expect(t('deleteWarning', { count: 1, name: 'Photo.png' })).toContain('Photo.png');
  });
  it('names the target of destructive settings actions and uses the real collection action label', () => {
    for (const key of [
      'keyWarning',
      'sessionWarning',
      'deleteUserWarning',
      'deleteCollectionHint',
    ] as const)
      expect(t(key, { name: 'Desktop' })).toContain('Desktop');
    expect(t('emptyState.collectionHint', { action: t('organize') })).toContain(t('organize'));
  });
});
