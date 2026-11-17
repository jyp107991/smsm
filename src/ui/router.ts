/**
 * The app's routes (S2 brief, "Interfaces → Routes"): `/` Home, `/activity`, `/entry/:id`, `/settings`.
 * One small router over the history coordinator (history.ts), so a sheet's back entry and a page change
 * never disagree. Anything else shows Home.
 */
import { useSyncExternalStore } from 'react';
import { currentPath, navigate, subscribeRoute } from './history';

export type Route =
  | { name: 'home' }
  | { name: 'activity' }
  | { name: 'entry'; id: string }
  | { name: 'settings' }
  | { name: 'bills' }
  | { name: 'inbox' }
  | { name: 'categories' }
  | { name: 'chapters' }
  | { name: 'insights' }
  | { name: 'recap'; month: string }
  | { name: 'year'; year: string }
  | { name: 'chapter'; id: string };

export function parseRoute(path: string): Route {
  const clean = (path.split(/[?#]/)[0] ?? '/').replace(/\/+$/, '') || '/';
  if (clean === '/activity') return { name: 'activity' };
  if (clean === '/settings') return { name: 'settings' };
  if (clean === '/bills') return { name: 'bills' };
  if (clean === '/insights') return { name: 'insights' };
  const recap = /^\/recap\/(\d{4}-\d{2})$/.exec(clean);
  if (recap?.[1]) return { name: 'recap', month: recap[1] };
  const year = /^\/year\/(\d{4})$/.exec(clean);
  if (year?.[1]) return { name: 'year', year: year[1] };
  if (clean === '/inbox') return { name: 'inbox' };
  if (clean === '/settings/categories') return { name: 'categories' };
  if (clean === '/settings/chapters') return { name: 'chapters' };
  const chapter = /^\/chapter\/([^/]+)$/.exec(clean);
  if (chapter?.[1]) return { name: 'chapter', id: decodeURIComponent(chapter[1]) };
  const entry = /^\/entry\/([^/]+)$/.exec(clean);
  if (entry?.[1]) return { name: 'entry', id: decodeURIComponent(entry[1]) };
  return { name: 'home' };
}

export function pathOf(route: Route): string {
  switch (route.name) {
    case 'home':
      return '/';
    case 'activity':
      return '/activity';
    case 'settings':
      return '/settings';
    case 'bills':
      return '/bills';
    case 'insights':
      return '/insights';
    case 'recap':
      return `/recap/${route.month}`;
    case 'year':
      return `/year/${route.year}`;
    case 'inbox':
      return '/inbox';
    case 'categories':
      return '/settings/categories';
    case 'chapters':
      return '/settings/chapters';
    case 'chapter':
      return `/chapter/${encodeURIComponent(route.id)}`;
    case 'entry':
      return `/entry/${encodeURIComponent(route.id)}`;
  }
}

/** The current path; re-renders when it changes (a tap, or back and forward). */
export function usePath(): string {
  return useSyncExternalStore(subscribeRoute, currentPath, currentPath);
}

export function useRoute(): Route {
  return parseRoute(usePath());
}

export function go(route: Route, opts: { replace?: boolean } = {}): void {
  navigate(pathOf(route), opts);
}
