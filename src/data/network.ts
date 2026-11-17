/**
 * Whether the phone has a connection. The data layer reads it through this small interface (not TanStack's
 * global online manager) so each store can be given its own network in tests, and two phones can be
 * simulated side by side.
 */
export interface Network {
  readonly online: boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}

/** The browser's view: navigator.onLine and the online/offline events. */
export function browserNetwork(): Network {
  return {
    get online() {
      return typeof navigator === 'undefined' ? true : navigator.onLine;
    },
    subscribe(listener) {
      const on = () => { listener(true); };
      const off = () => { listener(false); };
      window.addEventListener('online', on);
      window.addEventListener('offline', off);
      return () => {
        window.removeEventListener('online', on);
        window.removeEventListener('offline', off);
      };
    },
  };
}

/** A network a test or the demo switches by hand. */
export function manualNetwork(initial = true): Network & { set(online: boolean): void } {
  let state = initial;
  const listeners = new Set<(online: boolean) => void>();
  return {
    get online() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set(online) {
      if (online === state) return;
      state = online;
      for (const l of listeners) l(online);
    },
  };
}
