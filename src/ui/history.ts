/**
 * The one owner of the browser's history (DESIGN §6: Android's back gesture closes the sheet first, then
 * the page, then leaves the app). Pages are entries the router pushes; each open sheet adds one entry of its
 * own on top of its page (a "layer"), with the same address.
 *
 * Everything that touches `history` goes through here, so the two can never disagree:
 * - Back with a sheet open pops that sheet's entry: the sheet is told (it closes, or asks first).
 * - A sheet closed any other way removes its own entry again.
 * - Navigating while sheets are open first removes their entries, then pushes the new page, so a closed
 *   sheet's entry is never left behind between two pages (the S0/S1 review's finding).
 * - While the browser is still carrying out an earlier step (a back is asynchronous), later steps wait for
 *   it, so they happen in the order they were asked for.
 */

interface Layer {
  id: string;
  /** The person went back: the layer's entry is already gone. */
  onBack: () => void;
  /** The app is leaving the page under this layer: close without asking. */
  onLeave: () => void;
}

const LAYERS_KEY = 'smsmLayers';
/** Marks a page entry the app pushed, so "back" on screen can step back instead of leaving the app. */
const NAV_KEY = 'smsmNav';
const layers: Layer[] = [];
const routeListeners = new Set<(path: string) => void>();
/** popstate events still to come from our own history.back()/go(); they are not the person's. */
let ownPops = 0;
const afterPops: (() => void)[] = [];
let installed = false;
let current = typeof location === 'undefined' ? '/' : location.pathname + location.search;

function stateObject(): Record<string, unknown> {
  const s: unknown = history.state;
  return typeof s === 'object' && s !== null ? (s as Record<string, unknown>) : {};
}

function depthOf(): number {
  const d = stateObject()[LAYERS_KEY];
  return typeof d === 'number' && Number.isInteger(d) && d > 0 ? d : 0;
}

/** Runs the waiting steps in order, each only once the back steps before it have landed. */
function drain(): void {
  while (ownPops === 0 && afterPops.length > 0) afterPops.shift()?.();
}

/** Runs now, or after our own back steps still in flight have landed. */
function whenSettled(step: () => void): void {
  afterPops.push(step);
  drain();
}

function goBack(steps: number): void {
  ownPops += 1;
  history.go(-steps);
}

function notifyRoute(path: string): void {
  if (path === current) return;
  current = path;
  for (const l of [...routeListeners]) l(path);
}

function onPop(): void {
  if (ownPops > 0) {
    ownPops -= 1;
    drain();
    return;
  }
  const depth = depthOf();
  if (depth < layers.length) {
    // The person went back over one (or more) open sheets: they close, top first.
    const closing = layers.splice(depth).reverse();
    for (const l of closing) l.onBack();
    return;
  }
  if (depth > layers.length) {
    // Forward onto the entry of a sheet that has since closed: stay on the page, without the stale marker.
    history.replaceState({ ...stateObject(), [LAYERS_KEY]: layers.length }, '');
  }
  notifyRoute(location.pathname + location.search);
}

export function installHistory(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('popstate', onPop);
}

/** The page's address as the app sees it (it changes before a deferred push reaches the browser). */
export function currentPath(): string {
  return current;
}

export function subscribeRoute(listener: (path: string) => void): () => void {
  installHistory();
  routeListeners.add(listener);
  return () => {
    routeListeners.delete(listener);
  };
}

/** Goes to another page. Open sheets are left behind with the page (told to close), and their entries removed. */
export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  installHistory();
  const leaving = layers.splice(0);
  const write = () => {
    if (opts.replace) history.replaceState({ [LAYERS_KEY]: 0, [NAV_KEY]: stateObject()[NAV_KEY] === true }, '', path);
    else history.pushState({ [LAYERS_KEY]: 0, [NAV_KEY]: true }, '', path);
  };
  if (leaving.length > 0) {
    whenSettled(() => {
      goBack(leaving.length);
    });
  }
  if (path !== current || opts.replace) whenSettled(write);
  notifyRoute(path);
  for (const l of leaving) l.onLeave();
}

/** The page before this one, as the back gesture would (DESIGN §6); `fallback` when the app was opened here. */
export function goBackOrTo(fallback: string): void {
  installHistory();
  if (layers.length === 0 && ownPops === 0 && stateObject()[NAV_KEY] === true) {
    history.back();
  } else {
    navigate(fallback, { replace: true });
  }
}

/** A sheet opened: it owns one history entry on top of the page until it closes. Calling again updates it. */
export function openLayer(id: string, handlers: { onBack: () => void; onLeave: () => void }): void {
  installHistory();
  const existing = layers.find((l) => l.id === id);
  if (existing) {
    existing.onBack = handlers.onBack;
    existing.onLeave = handlers.onLeave;
    return;
  }
  layers.push({ id, ...handlers });
  const depth = layers.length;
  whenSettled(() => {
    history.pushState({ ...stateObject(), [LAYERS_KEY]: depth }, '');
  });
}

/** A sheet closed by itself (Close, Save, a swipe): its entry goes. A no-op if back already took it. */
export function closeLayer(id: string): void {
  const i = layers.findIndex((l) => l.id === id);
  if (i === -1) return;
  const above = layers.length - i;
  layers.splice(i);
  // Only this sheet (and anything stacked on it) closes; their entries are the top `above` entries.
  whenSettled(() => {
    goBack(above);
  });
}

/** Whether the layer `id` is open and still answered by these handlers (not since taken over by another call). */
export function layerHeldBy(id: string, handlers: { onBack: () => void }): boolean {
  return layers.some((l) => l.id === id && l.onBack === handlers.onBack);
}

export function isLayerOpen(id: string): boolean {
  return layers.some((l) => l.id === id);
}

/** For tests: forget everything (the module keeps state across a test file). */
export function resetHistoryForTests(): void {
  layers.splice(0);
  ownPops = 0;
  afterPops.splice(0);
  current = location.pathname + location.search;
}
