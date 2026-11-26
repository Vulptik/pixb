export function timeDistance(date: Date, now: Date = new Date()): string {
  const diffSeconds = Math.round((date.getTime() - now.getTime()) / 1000);

  const divisions: Array<{ amount: number; name: Intl.RelativeTimeFormatUnit }> = [
    { amount: 60, name: 'seconds' },
    { amount: 60, name: 'minutes' },
    { amount: 24, name: 'hours' },
    { amount: 30, name: 'days' },
    { amount: 12, name: 'months' },
    { amount: Number.POSITIVE_INFINITY, name: 'years' },
  ];

  let duration = diffSeconds;
  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'always' });
      const formatted = formatter.format(duration, division.name);
      return formatted.replace(/^in\s+/, '').replace(/\s+ago$/, '');
    }
    duration = Math.round(duration / division.amount);
  }

  return 'just now';
}
