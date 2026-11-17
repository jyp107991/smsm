/**
 * Both themes, following the phone unless set (DESIGN §6). The choice is this phone's own (localStorage),
 * applied as `data-theme` on <html> before the first paint, and the status bar is tinted to match.
 */
import { useSyncExternalStore } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'smsm-theme';
/** The paper colour of each theme (DESIGN §3.1), for the status bar. */
const BAR = { light: '#DCDFCD', dark: '#1D221A' } as const;
const listeners = new Set<() => void>();

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

let current: ThemeChoice = typeof window === 'undefined' ? 'system' : read();

export function applyTheme(choice: ThemeChoice = current): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const media = meta.getAttribute('media') ?? '';
    const own = media.includes('dark') ? BAR.dark : BAR.light;
    meta.content = choice === 'system' ? own : BAR[choice];
  }
}

export function setTheme(choice: ThemeChoice): void {
  current = choice;
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* private mode: the choice lasts until the app closes */
  }
  applyTheme(choice);
  for (const l of listeners) l();
}

export function useTheme(): ThemeChoice {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => current,
    () => 'system',
  );
}
