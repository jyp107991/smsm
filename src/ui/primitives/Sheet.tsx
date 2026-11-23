import { lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { focusedElement, returnFocus } from '../focus';
import { closeLayer, layerHeldBy, openLayer } from '../history';
import { LoadBoundary, retryable } from '../loadRetry';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The sheet's heading, also its accessible name. */
  title: string;
  /** One line under the title, also read out as the dialog's description. */
  description?: string;
  /**
   * Something typed would be lost by closing. While true, every way of closing (back gesture, Close,
   * Escape, tapping outside) first asks inside the sheet; dragging down springs back instead of closing.
   */
  dirty?: boolean;
  /** Full height (the add sheet, DESIGN §4.2); otherwise as tall as its content. */
  full?: boolean;
  /** Pinned under the scrolling body, above the keyboard and the home indicator (Save goes here). */
  footer?: ReactNode;
  children: ReactNode;
}

/** How long after closing a sheet stays mounted: vaul's slide away (0.5 s) and a little more. */
const CLOSE_MS = 600;

type Impl = (props: SheetProps & { layerId?: string }) => ReactNode;
const file = retryable(() => import('./SheetImpl'));
/** Fetches the sheet's own file (with vaul), once. The app does this in idle time after the first screen. */
export function preloadSheet(): Promise<void> {
  return file.load().then(() => undefined);
}
const makeWaiting = () => lazy(async () => ({ default: (await file.load({ onScreen: true })).default as Impl }));
let Waiting = makeWaiting();

/**
 * While the sheet's file is on its way, the sheet already behaves as one (S9 review): it owns its history entry,
 * so back closes it rather than leaving the page; Escape closes it; focus goes back to what opened it. When the
 * file arrives the sheet itself takes the same history entry over.
 */
function Pending({ id, open, onOpenChange }: { id: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const opener = useRef<HTMLElement | null>(null);
  const latest = useRef(onOpenChange);
  useEffect(() => { latest.current = onOpenChange; });
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (open) opener.current = focusedElement();
  }, [open]);
  useEffect(() => {
    if (!open) {
      // Closed before the sheet ever showed: focus goes back where it was.
      if (wasOpen.current) returnFocus(opener.current);
      return;
    }
    wasOpen.current = true;
    const handlers = { onBack: () => { latest.current(false); }, onLeave: () => { latest.current(false); } };
    openLayer(id, handlers);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !layerHeldBy(id, handlers)) return;
      closeLayer(id);
      latest.current(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Deferred: when the sheet's file has arrived, the sheet has taken the entry over by then.
      setTimeout(() => { if (layerHeldBy(id, handlers)) closeLayer(id); }, 0);
    };
  }, [open, id]);
  return null;
}

/**
 * The one sheet component (SheetImpl.tsx: a vaul bottom sheet with its history entry, focus return and
 * "Discard your changes?").
 *
 * S9 (performance audit P2, P4): a sheet that has never opened, or has finished sliding away, isn't mounted at
 * all. Each mounted vaul root reads the page's scroll position as it mounts (a forced layout), and a screen holds
 * several closed sheets (Activity's filters): mounting them with the screen cost a layout each on a long page. The
 * sheet's code (vaul and the dialog parts) is fetched after the first screen, not with it; a sheet opened before
 * that waits for its file and then rises as usual. If the file doesn't arrive, the sheet says so with Try again.
 */
export function Sheet(props: SheetProps) {
  const { open, onOpenChange } = props;
  const layerId = useId();
  // How this opening is drawn: straight away when the file is here, else through React.lazy, which then stays
  // until the sheet has gone (switching while open would remount it mid-rise).
  const [mounted, setMounted] = useState<'ready' | 'waiting' | null>(open ? (file.loaded() ? 'ready' : 'waiting') : null);
  const [, setTries] = useState(0);
  if (open && !mounted) setMounted(file.loaded() ? 'ready' : 'waiting');
  useEffect(() => {
    if (open || !mounted) return;
    const timer = setTimeout(() => { setMounted(null); }, CLOSE_MS);
    return () => { clearTimeout(timer); };
  }, [open, mounted]);
  if (!mounted) return null;
  const loaded = file.loaded();
  const Ready = loaded ? (loaded.default as Impl) : null;
  if (mounted === 'ready' && Ready) return <Ready {...props} />;
  const Now = Waiting;
  if (!open && file.failures() > 0) return null;
  return (
    <LoadBoundary
      floating
      onRetry={() => {
        if (file.failures() >= 3) {
          location.reload();
          return;
        }
        Waiting = makeWaiting();
        setTries((n) => n + 1);
      }}
      onClose={() => { onOpenChange(false); }}
    >
      <Suspense fallback={<Pending id={layerId} open={open} onOpenChange={onOpenChange} />}>
        <Now {...props} layerId={layerId} />
      </Suspense>
    </LoadBoundary>
  );
}
