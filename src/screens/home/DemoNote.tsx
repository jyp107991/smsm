/**
 * S9b (demo only): the demo says once, quietly, that what is added to it goes when the page reloads. A caption at
 * the foot of Home (it moves nothing above it), shown on the first visit on this browser and not again.
 */
import { useEffect, useState } from 'react';
import { build } from '../../data';
import { strings } from '../../ui/strings';

const SEEN = 'smsm-demo-note-seen';

function seenBefore(): boolean {
  try { return localStorage.getItem(SEEN) === '1'; } catch { return true; }
}

export function DemoNote() {
  const [show] = useState(() => build.demo && !seenBefore());
  useEffect(() => {
    if (!show) return;
    try { localStorage.setItem(SEEN, '1'); } catch { /* storage blocked: the note may show again, which is harmless */ }
  }, [show]);
  if (!show) return null;
  return <p role="note" className="text-caption text-ink-2 m-0 text-center">{strings.home.demoNote}</p>;
}
