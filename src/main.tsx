import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import { App } from './App';
import { installGlobalErrorReporting } from './data/reporting';
import { applyTheme } from './ui/theme';
import { dismissBoot } from './ui/boot';
import { installPreloadRecovery } from './ui/loadRetry';
import { installShort } from './ui/short';

installGlobalErrorReporting();
// The theme this phone chose, before the first paint (DESIGN §6: both themes, following the system unless set).
applyTheme();
// S9b review 3: how short the screen is (index.html set it before the first paint; kept up to date from here).
installShort();

// Korean font slices for the default type (DESIGN §3.2): hundreds of small @font-face rules, so they
// load after first paint rather than blocking it. Until they arrive, Hangul shows in the phone's own font.
// (S9 review: asked for at once again. The rules never held up the first paint, and loading them late let a Hangul
// name on Home show in the phone's font, then swap and re-wrap. The font files are still fetched only for Hangul
// that is on screen.)
void import('./styles/fonts-korean-a.css').catch(() => undefined);

// S9 review: a file that fails to arrive in the background reloads the page once (src/ui/loadRetry.tsx).
installPreloadRecovery();

// S9: the static first paint (index.html) goes when the app draws its first screen (src/ui/boot.ts); should that
// never happen, it never stays over the page for long.
setTimeout(dismissBoot, 20_000);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
