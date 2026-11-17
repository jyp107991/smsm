/**
 * Error reporting to client_errors (S0's own check; ENGINEERING §6). Reports are queued on the phone
 * and sent when a signed-in sink exists, so crashes before sign-in or offline are not lost.
 */
import { describe, expect, it } from 'vitest';
import { createErrorReporter, type ClientError, type ErrorSink } from './errors';

type Row = Omit<ClientError, 'id'>;

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

class ThrowingStorage implements Storage {
  get length(): number {
    throw new Error('blocked');
  }
  clear(): void {
    throw new Error('blocked');
  }
  getItem(): string | null {
    throw new Error('blocked');
  }
  key(): string | null {
    throw new Error('blocked');
  }
  removeItem(): void {
    throw new Error('blocked');
  }
  setItem(): void {
    throw new DOMException('quota', 'QuotaExceededError');
  }
}

/** A sink that records every call and answers with `answer`. */
function recordingSink(answer: () => Promise<boolean> | boolean) {
  const calls: Row[][] = [];
  const sink: ErrorSink = async (rows) => {
    calls.push(rows);
    return answer();
  };
  return { sink, calls };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('createErrorReporter', () => {
  it('queues reports while there is no sink', async () => {
    const storage = new MemoryStorage();
    const r = createErrorReporter(storage, () => null);
    await r.report(new Error('first'), '/');
    await r.report(new Error('second'), '/gallery');
    expect(r.pending()).toBe(2);
    await r.flush();
    expect(r.pending()).toBe(2);
  });

  it('keeps the queue in storage, so a new reporter on the same storage still has it', async () => {
    const storage = new MemoryStorage();
    await createErrorReporter(storage, () => null).report(new Error('before reload'), '/');
    expect(createErrorReporter(storage, () => null).pending()).toBe(1);
  });

  it('flushes in order when a sink appears, sending rows without their local id', async () => {
    const storage = new MemoryStorage();
    let current: ErrorSink | null = null;
    const r = createErrorReporter(storage, () => current);
    await r.report(new Error('one'), '/a', { n: 1 });
    await r.report(new Error('two'), '/b');
    await r.report('three', '/c');
    const { sink, calls } = recordingSink(() => true);
    current = sink;
    await r.flush();
    expect(calls).toHaveLength(1);
    const rows = calls[0]!;
    expect(rows.map((x) => x.message)).toEqual(['one', 'two', 'three']);
    expect(rows.map((x) => x.route)).toEqual(['/a', '/b', '/c']);
    expect(rows[0]!.context).toEqual({ n: 1 });
    expect(rows[1]!.context).toBeNull();
    for (const row of rows) {
      expect(row).not.toHaveProperty('id');
      expect(Object.keys(row).sort()).toEqual(['app_version', 'context', 'message', 'route', 'stack']);
      expect(typeof row.app_version).toBe('string');
      expect(row.app_version.length).toBeGreaterThan(0);
    }
    expect(r.pending()).toBe(0);
    await r.flush();
    expect(calls).toHaveLength(1); // nothing left to send
  });

  it('sends straight away when a sink is already there', async () => {
    const { sink, calls } = recordingSink(() => true);
    const r = createErrorReporter(new MemoryStorage(), () => sink);
    await r.report(new Error('now'), '/');
    expect(calls.map((c) => c.map((x) => x.message))).toEqual([['now']]);
    expect(r.pending()).toBe(0);
  });

  it('keeps the queue when the sink returns false', async () => {
    const { sink, calls } = recordingSink(() => false);
    const r = createErrorReporter(new MemoryStorage(), () => sink);
    await r.report(new Error('a'), '/');
    await r.report(new Error('b'), '/');
    expect(r.pending()).toBe(2);
    await r.flush();
    expect(r.pending()).toBe(2);
    expect(calls.at(-1)!.map((x) => x.message)).toEqual(['a', 'b']);
  });

  it('keeps the queue when the sink throws or rejects, and does not throw itself', async () => {
    const storage = new MemoryStorage();
    const throwing: ErrorSink = () => {
      throw new Error('network down');
    };
    const rejecting: ErrorSink = () => Promise.reject(new Error('network down'));
    let current: ErrorSink = throwing;
    const r = createErrorReporter(storage, () => current);
    await expect(r.report(new Error('a'), '/')).resolves.toBeUndefined();
    expect(r.pending()).toBe(1);
    current = rejecting;
    await expect(r.flush()).resolves.toBeUndefined();
    expect(r.pending()).toBe(1);
    const { sink, calls } = recordingSink(() => true);
    current = sink;
    await r.flush();
    expect(calls[0]!.map((x) => x.message)).toEqual(['a']);
    expect(r.pending()).toBe(0);
  });

  it('caps the queue at 20, keeping the newest', async () => {
    const storage = new MemoryStorage();
    let current: ErrorSink | null = null;
    const r = createErrorReporter(storage, () => current);
    for (let i = 1; i <= 25; i += 1) await r.report(new Error(`e${String(i)}`), '/');
    expect(r.pending()).toBe(20);
    const { sink, calls } = recordingSink(() => true);
    current = sink;
    await r.flush();
    expect(calls[0]!.map((x) => x.message)).toEqual(Array.from({ length: 20 }, (_, i) => `e${String(i + 6)}`));
  });

  it('keeps reports added while a flush is in flight, and does not resend the ones already sent', async () => {
    const storage = new MemoryStorage();
    const gate = deferred<boolean>();
    const calls: Row[][] = [];
    let answer: () => Promise<boolean> = () => gate.promise;
    const sink: ErrorSink = (rows) => {
      calls.push(rows);
      return answer();
    };
    let current: ErrorSink | null = null;
    const r = createErrorReporter(storage, () => current);
    await r.report(new Error('early'), '/');
    current = sink;
    const inFlight = r.flush();
    await Promise.resolve();
    // Added while the first send is still waiting for the server.
    const late = r.report(new Error('late'), '/');
    gate.resolve(true);
    await inFlight;
    await late;
    expect(calls[0]!.map((x) => x.message)).toEqual(['early']);
    expect(r.pending()).toBe(1);
    answer = () => Promise.resolve(true);
    await r.flush();
    const sentAfter = calls.slice(1).flat().map((x) => x.message);
    expect(sentAfter).toEqual(['late']);
    expect(r.pending()).toBe(0);
  });

  it('truncates huge messages and stacks to 4000 characters', async () => {
    const { sink, calls } = recordingSink(() => true);
    const r = createErrorReporter(new MemoryStorage(), () => sink);
    const big = new Error('x'.repeat(10_000));
    big.stack = 'y'.repeat(10_000);
    await r.report(big, '/');
    const row = calls[0]![0]!;
    expect(row.message).toHaveLength(4000);
    expect(row.message).toBe('x'.repeat(4000));
    expect(row.stack).not.toBeNull();
    expect(row.stack!.length).toBeLessThanOrEqual(4000);
  });

  it('turns anything thrown into a message (strings, objects)', async () => {
    const { sink, calls } = recordingSink(() => true);
    const r = createErrorReporter(new MemoryStorage(), () => sink);
    await r.report('plain string', '/');
    await r.report({ code: 42 }, '/');
    const messages = calls.flat().map((x) => x.message);
    expect(messages[0]).toBe('plain string');
    expect(messages[1]).toContain('42');
  });

  it('never throws when storage throws', async () => {
    const { sink } = recordingSink(() => true);
    for (const getSink of [() => null, () => sink]) {
      const r = createErrorReporter(new ThrowingStorage(), getSink);
      await expect(r.report(new Error('while storage is blocked'), '/')).resolves.toBeUndefined();
      await expect(r.flush()).resolves.toBeUndefined();
      expect(() => r.pending()).not.toThrow();
    }
  });

  it('survives corrupt data in storage', async () => {
    const storage = new MemoryStorage();
    storage.setItem('smsm.pendingErrors', '{not json');
    const r = createErrorReporter(storage, () => null);
    expect(r.pending()).toBe(0);
    await expect(r.report(new Error('after corruption'), '/')).resolves.toBeUndefined();
    expect(r.pending()).toBe(1);
  });
});
