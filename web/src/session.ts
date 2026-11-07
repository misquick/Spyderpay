import { useCallback, useSyncExternalStore } from 'react';

/** The merchant's API key, kept in this browser only. */
const KEY = 'cryptopay.apiKey';
const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return memory;
  }
}
let memory: string | null = null;

function write(value: string | null) {
  memory = value;
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable (private mode) — keep it in memory */
  }
  listeners.forEach((l) => l());
}

export function useSession() {
  const apiKey = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
  );
  const signIn = useCallback((key: string) => write(key.trim()), []);
  const signOut = useCallback(() => write(null), []);
  return { apiKey, signIn, signOut };
}
