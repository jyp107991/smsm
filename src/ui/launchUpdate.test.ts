/**
 * Owner, 17 Nov: "app must check for updates on launch and update if it is not latest version, and must show
 * progress bar of updating." A phone stayed on an old version because the old app only offered "Refresh"
 * (hidden behind the tab bar in that version) and its service worker waited for every window to close.
 *
 * createLaunchUpdate: on launch (or a return after a while), compare the running build with /version.json;
 * if the server has a newer one, install it through the service worker, save the waiting writes, reload.
 * It reports its stage and progress (0–1) for the "Updating smsm" bar. Offline or unreadable → nothing.
 */
import { describe, expect, it, vi } from 'vitest';
import { createLaunchUpdate, type UpdateStage } from './launchUpdate';

type Listener = () => void;

function fakeWorker(state: ServiceWorkerState = 'installing') {
  const listeners: Listener[] = [];
  const w = {
    state,
    postMessage: vi.fn(),
    addEventListener: (_: string, cb: Listener) => { listeners.push(cb); },
    go(next: ServiceWorkerState) { w.state = next; for (const l of listeners) l(); },
  };
  return w;
}

function fakeContainer(reg: unknown) {
  const listeners: Listener[] = [];
  return {
    container: {
      getRegistration: () => Promise.resolve(reg),
      addEventListener: (_: string, cb: Listener) => { listeners.push(cb); },
      removeEventListener: () => undefined,
    } as unknown as ServiceWorkerContainer,
    takeOver: () => { for (const l of listeners) l(); },
  };
}

function memorySession() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
}

function deps(over: Partial<Parameters<typeof createLaunchUpdate>[0]> = {}) {
  const stages: [UpdateStage, number][] = [];
  const reload = vi.fn();
  const beforeReload = vi.fn(() => Promise.resolve());
  return {
    stages,
    reload,
    beforeReload,
    d: {
      current: 'old1111',
      fetchVersion: () => Promise.resolve('new2222'),
      beforeReload,
      reload,
      onStage: (s: UpdateStage, p: number) => { stages.push([s, p]); },
      session: memorySession(),
      timeoutMs: 1000,
      ...over,
    },
  };
}

describe('launch update (owner, 17 Nov)', () => {
  it('already the latest version: nothing to do, no reload, no progress shown', async () => {
    const { d, reload, stages } = deps({ fetchVersion: () => Promise.resolve('old1111') });
    expect(await createLaunchUpdate(d)()).toBe('latest');
    expect(reload).not.toHaveBeenCalled();
    expect(stages.filter(([s]) => s !== 'checking' && s !== 'idle')).toEqual([]);
  });

  it('offline or the version can’t be read: the app opens as it is (nothing blocks)', async () => {
    const { d, reload } = deps({ fetchVersion: () => Promise.reject(new Error('offline')) });
    expect(await createLaunchUpdate(d)()).toBe('skipped');
    expect(reload).not.toHaveBeenCalled();
  });

  it('a newer version: it is downloaded and installed, the waiting writes are saved, then the app restarts — with rising progress', async () => {
    const installing = fakeWorker();
    const reg = { installing: null as unknown, waiting: null, addEventListener: vi.fn(), update: vi.fn() };
    let onFound: Listener = () => undefined;
    reg.addEventListener = vi.fn((_: string, cb: Listener) => { onFound = cb; });
    reg.update = vi.fn(() => { reg.installing = installing; onFound(); return Promise.resolve(); });
    const { container, takeOver } = fakeContainer(reg);
    const { d, reload, beforeReload, stages } = deps({ container });
    const run = createLaunchUpdate(d)();
    await vi.waitFor(() => { expect(reg.update).toHaveBeenCalled(); });
    installing.go('installed');
    expect(installing.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    installing.go('activated');
    takeOver();
    expect(await run).toBe('updated');
    expect(beforeReload).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
    const shown = stages.filter(([s]) => s !== 'checking');
    expect(shown.map(([s]) => s)).toEqual(expect.arrayContaining(['downloading', 'installing', 'restarting']));
    const progress = shown.map(([, p]) => p);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress.at(-1)).toBe(1);
  });

  it('a newer version already waiting: it is told to take over at once', async () => {
    const waiting = fakeWorker('installed');
    const reg = { installing: null, waiting, addEventListener: vi.fn(), update: vi.fn(() => Promise.resolve()) };
    const { container, takeOver } = fakeContainer(reg);
    const { d, reload } = deps({ container });
    const run = createLaunchUpdate(d)();
    await vi.waitFor(() => { expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' }); });
    takeOver();
    expect(await run).toBe('updated');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('the new version is already in charge but this page is old: one reload, never a loop', async () => {
    const reg = { installing: null, waiting: null, addEventListener: vi.fn(), update: vi.fn(() => Promise.resolve()) };
    const { container } = fakeContainer(reg);
    const session = memorySession();
    const first = deps({ container, session });
    expect(await createLaunchUpdate(first.d)()).toBe('updated');
    expect(first.reload).toHaveBeenCalledTimes(1);
    // The reloaded page is somehow still the old build: it doesn't reload again for the same version.
    const second = deps({ container, session });
    expect(await createLaunchUpdate(second.d)()).toBe('failed');
    expect(second.reload).not.toHaveBeenCalled();
  });

  it('an install that never finishes gives up after the time limit (the app stays usable)', async () => {
    vi.useFakeTimers();
    try {
      const installing = fakeWorker();
      const reg = { installing, waiting: null, addEventListener: vi.fn(), update: vi.fn(() => new Promise<void>(() => undefined)) };
      const { container } = fakeContainer(reg);
      const { d, reload } = deps({ container, timeoutMs: 1000 });
      const run = createLaunchUpdate(d)();
      await vi.advanceTimersByTimeAsync(1500);
      expect(await run).toBe('failed');
      expect(reload).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('no service worker (a plain browser): a newer version is fetched by reloading once', async () => {
    const { d, reload, beforeReload } = deps({ container: undefined });
    expect(await createLaunchUpdate(d)()).toBe('updated');
    expect(beforeReload).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
