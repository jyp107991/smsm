import { IsRestoringProvider, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { DataContext, installDataLayer } from './context';
import type { DataLayer } from './queryClient';

/**
 * Makes a data layer available to the screens. Queries wait until the phone's copy is restored from
 * IndexedDB (so the first paint uses it, not an empty list), then refresh from the server.
 */
export function DataProvider({ layer, children }: { layer: DataLayer; children: ReactNode }) {
  const [restoring, setRestoring] = useState(true);
  // Installed during render so plain write functions work from the first event handler.
  installDataLayer(layer);
  useEffect(() => {
    let live = true;
    void layer.ready.finally(() => {
      if (live) setRestoring(false);
    });
    return () => {
      live = false;
    };
  }, [layer]);
  return (
    <DataContext.Provider value={layer}>
      <QueryClientProvider client={layer.client}>
        <IsRestoringProvider value={restoring}>{children}</IsRestoringProvider>
      </QueryClientProvider>
    </DataContext.Provider>
  );
}
