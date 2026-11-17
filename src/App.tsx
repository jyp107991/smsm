import { lazy, Suspense, use } from 'react';
import { Shell } from './screens/shell/Shell';
import { UpdatePrompt } from './ui/UpdatePrompt';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { createAppDataLayer, DataProvider, type DataLayer } from './data';
import { Root } from './screens/AppRoot';
import { installHistory } from './ui/history';

// The gallery exists only in the demo build (DESIGN §7); the production bundle never contains it.
// __APP_DEMO__ is replaced at build time, so the production bundle drops this import entirely.
const Gallery = __APP_DEMO__ ? lazy(() => import('./screens/gallery/Gallery')) : null;

/** One data layer for the life of the page: Supabase and IndexedDB in the app, the seeded household in the demo. */
let starting: Promise<DataLayer | null> | null = null;
function dataLayer(): Promise<DataLayer | null> {
  starting ??= createAppDataLayer();
  return starting;
}

function Started() {
  const layer = use(dataLayer());
  // A build with no household server configured (and not the demo): say so rather than show a broken app.
  if (!layer) return <Shell />;
  return (
    <DataProvider layer={layer}>
      <Root />
    </DataProvider>
  );
}

export function App() {
  const onGallery = Gallery !== null && location.pathname.startsWith('/gallery');
  if (!onGallery) installHistory();
  return (
    <ErrorBoundary>
      {onGallery ? (
        <Suspense fallback={null}>
          <Gallery />
        </Suspense>
      ) : (
        <Suspense fallback={<div className="min-h-dvh" />}>
          <Started />
        </Suspense>
      )}
      <UpdatePrompt />
    </ErrorBoundary>
  );
}
