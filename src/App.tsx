import { lazy, Suspense } from 'react';
import { build } from './data/build';
import { Shell } from './screens/shell/Shell';
import { UpdatePrompt } from './ui/UpdatePrompt';
import { ErrorBoundary } from './ui/ErrorBoundary';

// The gallery exists only in the demo build (DESIGN §7); the production bundle never contains it.
const Gallery = build.demo ? lazy(() => import('./screens/gallery/Gallery')) : null;

export function App() {
  const onGallery = Gallery !== null && location.pathname.startsWith('/gallery');
  return (
    <ErrorBoundary>
      {onGallery ? (
        <Suspense fallback={null}>
          <Gallery />
        </Suspense>
      ) : (
        <Shell />
      )}
      <UpdatePrompt />
    </ErrorBoundary>
  );
}
