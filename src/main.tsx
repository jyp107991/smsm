import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import { App } from './App';
import { installGlobalErrorReporting } from './data/reporting';
import { applyTheme } from './ui/theme';
import { dismissBoot, whenFirstScreen } from './ui/boot';

installGlobalErrorReporting();
// The theme this phone chose, before the first paint (DESIGN §6: both themes, following the system unless set).
applyTheme();

// Korean font slices for the default type (DESIGN §3.2): hundreds of small @font-face rules, so they
// load after first paint rather than blocking it. Until they arrive, Hangul shows in the phone's own font.
// S9: after the first real screen has painted, so they never hold it up on a slow connection.
void whenFirstScreen().then(() => import('./styles/fonts-korean-a.css'));

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
