/**
 * The data layer in use. The app installs one at start (DataProvider does it), tests install their own
 * with a fake Api. Hooks read it from React context, plain write functions from here.
 */
import { createContext } from 'react';
import type { DataLayer } from './queryClient';

let active: DataLayer | null = null;

export function installDataLayer(layer: DataLayer | null): void {
  active = layer;
}

export function activeDataLayer(): DataLayer {
  if (!active) throw new Error('The data layer has not been started (wrap the app in <DataProvider>).');
  return active;
}

export const DataContext = createContext<DataLayer | null>(null);
