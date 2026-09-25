'use client';

import { useSyncExternalStore } from 'react';

const subscribeToHydration = () => () => undefined;

export function useHasHydrated() {
  return useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
}
