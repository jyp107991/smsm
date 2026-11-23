/**
 * S9b (demo only): the demo says once, quietly, that what is added to it goes when the page reloads. A caption at
 * the foot of Home (it moves nothing above it). It counts as said only once it has been on screen (S9b review: at the
 * foot of Home most visits never reach it); then it isn't shown again on this browser.
 */
import { useEffect, useRef, useState } from 'react';
import { build } from '../../data';
import { strings } from '../../ui/strings';

const SEEN = 'smsm-demo-note-seen';

function seenBefore(): boolean {
  try { return localStorage.getItem(SEEN) === '1'; } catch { return true; }
}

export function DemoNote() {
  const [show] = useState(() => build.demo && !seenBefore());
  const note = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = note.current;
    if (!show || !el || typeof IntersectionObserver === 'undefined') return;
    const watch = new IntersectionObserver((seen) => {
      if (!seen.some((e) => e.isIntersecting)) return;
      try { localStorage.setItem(SEEN, '1'); } catch { /* storage blocked: the note may show again, which is harmless */ }
      watch.disconnect();
    }, { threshold: 1 });
    watch.observe(el);
    return () => { watch.disconnect(); };
  }, [show]);
  if (!show) return null;
  return <p ref={note} role="note" className="text-caption text-ink-2 m-0 text-center">{strings.home.demoNote}</p>;
}
