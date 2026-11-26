import { defaultLocale, locales, type Locale } from './config';

export function resolveLocale(
  preference: string | undefined,
  acceptLanguage: string | null,
): Locale {
  if (locales.includes(preference as Locale)) return preference as Locale;

  const candidates = (acceptLanguage || '')
    .split(',')
    .map((entry, index) => {
      const [tag, ...parameters] = entry.trim().split(';');
      const quality = parameters.find((parameter) => /^\s*q=/i.test(parameter));
      const weight = quality === undefined ? 1 : Number(quality.split('=')[1]);
      return { locale: tag.trim().toLowerCase().split('-')[0], weight, index };
    })
    .filter(
      ({ locale, weight }) =>
        locales.includes(locale as Locale) && Number.isFinite(weight) && weight > 0 && weight <= 1,
    )
    .sort((a, b) => b.weight - a.weight || a.index - b.index);

  return (candidates[0]?.locale as Locale | undefined) ?? defaultLocale;
}
