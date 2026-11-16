import { build } from './build';

/** One crash report, as stored in client_errors (ENGINEERING §6: read errors from real use). */
export interface ClientError {
  /** Made on the phone; lets a flush remove exactly the reports it sent. Not stored in the database. */
  id: string;
  message: string;
  stack: string | null;
  route: string;
  app_version: string;
  context: Record<string, unknown> | null;
}

/** Sends rows (without their local ids) to client_errors; true when stored. */
export type ErrorSink = (rows: Omit<ClientError, 'id'>[]) => Promise<boolean>;

const KEY = 'smsm.pendingErrors';
const MAX_QUEUED = 20;
const MAX_TEXT = 4000;

function readQueue(storage: Storage): ClientError[] {
  try {
    const raw = storage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as ClientError[]).filter((r) => typeof r.id === 'string') : [];
  } catch {
    return [];
  }
}

function writeQueue(storage: Storage, rows: ClientError[]): void {
  try {
    storage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* storage full or blocked: drop silently rather than crash while reporting a crash */
  }
}

function withoutId(r: ClientError): Omit<ClientError, 'id'> {
  return { message: r.message, stack: r.stack, route: r.route, app_version: r.app_version, context: r.context };
}

let counter = 0;
function newId(): string {
  counter += 1;
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `e${String(counter)}-${String(performance.now())}`;
}

export function toClientError(err: unknown, route: string, context: Record<string, unknown> | null = null): ClientError {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err));
  return {
    id: newId(),
    message: e.message.slice(0, MAX_TEXT) || 'Unknown error',
    stack: e.stack ? e.stack.slice(0, MAX_TEXT) : null,
    route,
    app_version: `${build.version}+${build.commit.slice(0, 7)}`,
    context,
  };
}

/**
 * Queues errors on the phone and sends them when a sink is available (a signed-in client), so
 * crashes before sign-in or while offline are not lost.
 */
export function createErrorReporter(storage: Storage, getSink: () => ErrorSink | null) {
  let flushing = false;
  async function flush(): Promise<void> {
    if (flushing) return;
    const sink = getSink();
    const queued = readQueue(storage);
    if (!sink || queued.length === 0) return;
    flushing = true;
    try {
      const sent = new Set(queued.map((r) => r.id));
      if (await sink(queued.map(withoutId))) {
        writeQueue(storage, readQueue(storage).filter((r) => !sent.has(r.id)));
      }
    } catch {
      /* keep the queue for next time */
    } finally {
      flushing = false;
    }
  }
  function report(err: unknown, route: string, context: Record<string, unknown> | null = null): Promise<void> {
    // The cap applies only when adding, so a flush in progress never loses reports added meanwhile.
    writeQueue(storage, [...readQueue(storage), toClientError(err, route, context)].slice(-MAX_QUEUED));
    return flush();
  }
  return { report, flush, pending: () => readQueue(storage).length };
}
