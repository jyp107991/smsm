import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';

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

let impl: ((props: SheetProps) => ReactNode) | null = null;
let loading: Promise<void> | null = null;
/** Fetches the sheet's own file (with vaul), once. The app does this in idle time after the first screen. */
export function preloadSheet(): Promise<void> {
  loading ??= import('./SheetImpl').then(
    (m) => { impl = m.default; },
    (err: unknown) => { loading = null; throw err; },
  );
  return loading;
}
const Waiting = lazy(async () => {
  await preloadSheet();
  return { default: impl ?? (() => null) };
});

/**
 * The one sheet component (SheetImpl.tsx: a vaul bottom sheet with its history entry, focus return and
 * "Discard your changes?").
 *
 * S9 (performance audit P2, P4): a sheet that has never opened, or has finished sliding away, isn't mounted at
 * all. Each mounted vaul root reads the page's scroll position as it mounts (a forced layout), and a screen holds
 * several closed sheets (Activity's filters): mounting them with the screen cost a layout each on a long page. The
 * sheet's code (vaul and the dialog parts) is fetched after the first screen, not with it; a sheet opened before
 * that waits for its file and then rises as usual.
 */
export function Sheet(props: SheetProps) {
  const { open } = props;
  // How this opening is drawn: straight away when the file is here, else through React.lazy, which then stays
  // until the sheet has gone (switching while open would remount it mid-rise).
  const [mounted, setMounted] = useState<'ready' | 'waiting' | null>(open ? (impl ? 'ready' : 'waiting') : null);
  if (open && !mounted) setMounted(impl ? 'ready' : 'waiting');
  useEffect(() => {
    if (open || !mounted) return;
    const timer = setTimeout(() => { setMounted(null); }, CLOSE_MS);
    return () => { clearTimeout(timer); };
  }, [open, mounted]);
  if (!mounted) return null;
  const Ready = impl;
  if (mounted === 'ready' && Ready) return <Ready {...props} />;
  return (
    <Suspense fallback={null}>
      <Waiting {...props} />
    </Suspense>
  );
}
