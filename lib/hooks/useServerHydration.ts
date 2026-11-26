'use client';

import { useRef, useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const clientSnapshot = () => false;
const serverSnapshot = () => true;

/** True only for the component's original server hydration, not later route mounts. */
export function useServerHydration() {
  const hydrating = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  return useRef(hydrating).current;
}
