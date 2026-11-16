import { build } from './build';

/** One crash report, as stored in client_errors (ENGINEERING §6: read errors from real use). */
export interface ClientError {
  message: string;
  stack: string | null;
  route: string;
  app_version: string;
  context: Record<string, unknown> | null;
}

export type ErrorSink = (rows: ClientError[]) => Promise<boolean>;

const KEY = 'smsm.pendingErrors';
const MAX_QUEUED = 20;
const MAX_TEXT = 4000;

function readQueue(storage: Storage): ClientError[] {
  try {
    const raw = storage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as ClientError[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(storage: Storage, rows: ClientError[]): void {
  try {
    storage.setItem(KEY, JSON.stringify(rows.slice(-MAX_QUEUED)));
  } catch {
    /* storage full or blocked: drop silently rather than crash while reporting a crash */
  }
}

export function toClientError(err: unknown, route: string, context: Record<string, unknown> | null = null): ClientError {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err));
  return {
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
      if (await sink(queued)) writeQueue(storage, readQueue(storage).slice(queued.length));
    } catch {
      /* keep the queue for next time */
    } finally {
      flushing = false;
    }
  }
  function report(err: unknown, route: string, context: Record<string, unknown> | null = null): Promise<void> {
    writeQueue(storage, [...readQueue(storage), toClientError(err, route, context)]);
    return flush();
  }
  return { report, flush, pending: () => readQueue(storage).length };
}
