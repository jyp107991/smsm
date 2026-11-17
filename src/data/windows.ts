/**
 * One window owns the queue (OFF-5, OFF-7, ADD-6). Two windows of the app on one phone (two tabs, or the
 * installed app and a browser tab) share one IndexedDB. If both restored, saved and sent the queue, one
 * could erase a write the other just queued, or replay an old queue over a newer value. So exactly one
 * window holds the Web Lock `smsm-queue` for as long as it is open: only it restores, saves and sends the
 * waiting writes. Any other window is a follower: it reads the household (from the phone's copy and the
 * server) and refuses money writes with a plain message, and it takes over the moment the owner closes
 * (the browser releases a closed window's locks), restoring the queue from storage.
 *
 * Without the Web Locks API (browsers before 2022) there is no way to coordinate windows; the window works
 * as the only one, as it did before (DECISIONS).
 */

export const QUEUE_LOCK = 'smsm-queue';

/** The part of the Web Locks API used here (`navigator.locks` fits it). */
export interface QueueLocks {
  request(
    name: string,
    options: { mode: 'exclusive'; signal?: AbortSignal },
    callback: (lock: unknown) => Promise<void>,
  ): Promise<unknown>;
}

/** 'opening' until the lock has answered (milliseconds); then this window owns the queue or follows. */
export type WindowRole = 'opening' | 'owner' | 'follower';

/** A money write was tried in a window that doesn't own the queue (the screens word it: strings.windows). */
export class OtherWindowError extends Error {
  constructor() {
    super('another window owns the write queue');
    this.name = 'OtherWindowError';
  }
}

export interface QueueClaim {
  /** Whether this window owns the queue from the start. */
  role: Promise<'owner' | 'follower'>;
  /** The window closes: give the lock back (or stop waiting for it). */
  release(): void;
}

/**
 * How long a window that finds the lock taken waits before it opens as a follower. A page that reloads
 * (the update prompt) asks while the page it replaces may still be letting go; it should open as the owner,
 * not flash "open in another window".
 */
export const CLAIM_GRACE_MS = 300;

/**
 * Asks for the queue. `onTakeOver` is called when a follower is handed the lock (the owner closed).
 * `locks` null or undefined: no coordination is possible; this window owns the queue.
 */
export function claimQueue(locks: QueueLocks | null | undefined, onTakeOver: () => void, graceMs = CLAIM_GRACE_MS): QueueClaim {
  if (!locks) return { role: Promise.resolve('owner'), release: () => undefined };
  const abort = new AbortController();
  let released = false;
  let letGo: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { letGo = resolve; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const role = new Promise<'owner' | 'follower'>((resolve) => {
    let decided = false;
    const decide = (r: 'owner' | 'follower') => {
      if (decided) return false;
      decided = true;
      clearTimeout(timer);
      resolve(r);
      return true;
    };
    // One request, held for the window's life: granted at once (owner), soon (the page it replaces let
    // go), or only when the owning window closes (a follower that then takes over).
    timer = setTimeout(() => { decide('follower'); }, graceMs);
    try {
      locks
        .request(QUEUE_LOCK, { mode: 'exclusive', signal: abort.signal }, async () => {
          if (released) return;
          if (!decide('owner')) onTakeOver();
          await held;
        })
        // Refused (a sandboxed frame, an opaque origin): work as the only window. Aborted on close: done.
        .catch(() => { decide('owner'); });
    } catch {
      decide('owner');
    }
  });
  return {
    role,
    release() {
      released = true;
      clearTimeout(timer);
      abort.abort();
      letGo();
    },
  };
}

/** The browser's Web Locks, or null where the API is missing. */
export function browserLocks(): QueueLocks | null {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) return null;
  const locks = (navigator as { locks?: unknown }).locks;
  return locks && typeof (locks as { request?: unknown }).request === 'function' ? (locks as QueueLocks) : null;
}

/** Web Locks in memory, shared by the "windows" of one test (or two layers in one page). */
export function memoryLocks(): QueueLocks {
  const holders = new Set<string>();
  const waiting = new Map<string, (() => void)[]>();
  const next = (name: string) => {
    holders.delete(name);
    waiting.get(name)?.shift()?.();
  };
  return {
    request(name, options, callback) {
      return new Promise((resolve, reject) => {
        const grant = () => {
          holders.add(name);
          void Promise.resolve()
            .then(() => callback({ name, mode: 'exclusive' }))
            .then(resolve, reject)
            .finally(() => { next(name); });
        };
        if (!holders.has(name)) {
          grant();
          return;
        }
        const queue = waiting.get(name) ?? [];
        waiting.set(name, queue);
        const entry = () => { grant(); };
        queue.push(entry);
        options.signal?.addEventListener('abort', () => {
          const i = queue.indexOf(entry);
          if (i !== -1) queue.splice(i, 1);
          reject(new DOMException('The request was aborted.', 'AbortError'));
        });
      });
    },
  };
}
