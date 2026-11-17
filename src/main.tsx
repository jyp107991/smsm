import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import { App } from './App';
import { installGlobalErrorReporting } from './data/reporting';
import { applyTheme } from './ui/theme';

installGlobalErrorReporting();
// The theme this phone chose, before the first paint (DESIGN §6: both themes, following the system unless set).
applyTheme();

// Korean font slices for the default type (DESIGN §3.2): hundreds of small @font-face rules, so they
// load after first paint rather than blocking it. Until they arrive, Hangul shows in the phone's own font.
void import('./styles/fonts-korean-a.css');

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
