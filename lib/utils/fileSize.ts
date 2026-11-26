/** Format file metadata consistently across private and public viewers. */
export function formatFileSize(bytes: string | number, locale: string): string {
  const size = Number(bytes);
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;
  const index =
    size > 0 ? Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1) : 0;
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: units[index],
    unitDisplay: index === 0 ? 'narrow' : 'short',
    maximumFractionDigits: 1,
  }).format(size / 1024 ** index);
}
