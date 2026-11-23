/**
 * S9 review: what happens when one of the app's on-demand files doesn't arrive (offline before it was cached, a
 * flaky connection, a new version that has removed the old files).
 *
 * - A browser remembers a failed dynamic import for the life of the page (asking again gives the same failure),
 *   and React.lazy keeps a rejection for good. So a retry imports the failed file's address with a query of its
 *   own (a new module to the browser; its own imports are the ones already loaded), and the next render uses a
 *   new React.lazy.
 * - The failure stays where it happened: a screen or sheet shows "Couldn't load this." with Try again
 *   (`LoadBoundary`), never the whole app's error page. A second failed retry reloads the page.
 * - `installPreloadRecovery`: when Vite reports a failed file (`vite:preloadError`) while the person isn't in the
 *   middle of something (no sheet open, no text box in use) and nothing on screen asked for it, the page reloads
 *   once per session, the usual cure after a new version has gone out.
 */
import { Component, type ReactNode } from 'react';
import { strings } from './strings';

/** The address of the file a failed dynamic import named (Chrome and Firefox name it; Safari doesn't). */
export function failedFileOf(err: unknown): string | null {
  const text = err instanceof Error ? err.message : String(err);
  const m = /(https?:\/\/[^\s'"]+?\.(?:m?js|css))(?:\?[^\s'"]*)?/.exec(text);
  return m?.[1] ?? null;
}

/** How many on-screen loads (a screen or sheet someone asked for) are in flight: their failures stay local. */
let onScreen = 0;

export interface Retryable<M> {
  /** Loads the module (once while it works); after a failure, the next call tries again. */
  load: (opts?: { onScreen?: boolean }) => Promise<M>;
  /** The module, once loaded. */
  loaded: () => M | null;
  /** Failures in a row since the last success. */
  failures: () => number;
}

export function retryable<M>(importer: () => Promise<M>): Retryable<M> {
  let mod: M | null = null;
  let loading: Promise<M> | null = null;
  let lastError: unknown = null;
  let failures = 0;
  const again = (): Promise<M> => {
    const file = failedFileOf(lastError);
    // A new address for the same file: the browser fetches it afresh instead of repeating its failure.
    return file ? (import(/* @vite-ignore */ `${file}?retry=${String(Date.now())}`) as Promise<M>) : importer();
  };
  const load = (opts: { onScreen?: boolean } = {}): Promise<M> => {
    if (!loading) {
      if (opts.onScreen) onScreen += 1;
      loading = (lastError === null ? importer() : again())
        .then((m) => {
          if (m === undefined || m === null) throw new Error('The file arrived empty.');
          mod = m;
          lastError = null;
          failures = 0;
          return m;
        })
        .catch((err: unknown) => {
          lastError = err;
          failures += 1;
          loading = null;
          throw err;
        })
        .finally(() => {
          if (opts.onScreen) onScreen -= 1;
        });
    }
    return loading;
  };
  return { load, loaded: () => mod, failures: () => failures };
}

/**
 * Reloads the page once per session when a file fails to arrive in the background (`vite:preloadError`), unless a
 * screen or sheet asked for it (it shows its own Try again) or the person is busy (a sheet open, typing).
 * `reload` is for tests. Returns the listener's removal.
 */
export function installPreloadRecovery(reload: () => void = () => { location.reload(); }): () => void {
  const KEY = 'smsm-reloaded-for-files';
  const onError = (event: Event) => {
    if (onScreen > 0) return;
    const busy = document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
      || (document.activeElement instanceof HTMLElement && document.activeElement.matches('input, textarea, select, [contenteditable="true"]'));
    if (busy) return;
    try {
      if (sessionStorage.getItem(KEY) !== null) return;
      sessionStorage.setItem(KEY, '1');
    } catch {
      return;
    }
    event.preventDefault();
    reload();
  };
  window.addEventListener('vite:preloadError', onError);
  return () => { window.removeEventListener('vite:preloadError', onError); };
}

/** "Couldn't load this." with Try again (and Close, for a sheet). */
export function CouldntLoad({ onRetry, onClose, floating = false }: { onRetry: () => void; onClose?: () => void; floating?: boolean }) {
  return (
    <div
      role="alert"
      className={floating
        ? 'bg-surface text-ink shadow-float fixed inset-x-0 bottom-0 z-[60] mx-auto flex w-full max-w-lg flex-col gap-3 rounded-t-[28px] px-5 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))]'
        : 'mx-auto flex max-w-lg flex-col gap-3 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-10'}
    >
      <p className="text-body m-0">{strings.errors.couldntLoad}</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onRetry} className="bg-forest text-on-forest press min-h-11 rounded-full px-5 font-semibold">
          {strings.errors.tryAgain}
        </button>
        {onClose ? (
          <button type="button" onClick={onClose} className="bg-sunk text-ink press min-h-11 rounded-full px-5 font-semibold">
            {strings.ui.close}
          </button>
        ) : null}
      </div>
    </div>
  );
}

interface BoundaryProps {
  children: ReactNode;
  /** Ready to try again: a fresh React.lazy, the file asked for afresh. */
  onRetry: () => void;
  onClose?: () => void;
  floating?: boolean;
}

/** Keeps a file that didn't arrive to its own screen or sheet. */
export class LoadBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <CouldntLoad
        floating={this.props.floating ?? false}
        onRetry={() => {
          this.props.onRetry();
          this.setState({ failed: false });
        }}
        {...(this.props.onClose ? { onClose: this.props.onClose } : {})}
      />
    );
  }
}
