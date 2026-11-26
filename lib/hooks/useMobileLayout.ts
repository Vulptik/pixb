'use client';

import { useSyncExternalStore } from 'react';

const query = '(max-width: 700px), (max-height: 500px) and (max-width: 1000px)';
function subscribe(update: () => void) {
  const media = window.matchMedia?.(query);
  media?.addEventListener('change', update);
  return () => media?.removeEventListener('change', update);
}
function snapshot() {
  return window.matchMedia?.(query).matches ?? false;
}

export function useMobileLayout() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
