import type { PoolClient } from 'pg';

import { getDatabasePool } from '@/lib/db/prisma';

// Separate two-key namespace from maintenance and per-user quota locks.
const LOCK_KEYS = [1_347_095_106, 2];
const WAIT_MS = 10_000;

type Lease = {
  client: PoolClient;
  controller: AbortController;
  references: number;
  onError: (error: Error) => void;
};
type ActivityState = { transition: Promise<void>; lease?: Lease };
const runtime = globalThis as typeof globalThis & { pixbTusActivity?: ActivityState };
const state = (runtime.pixbTusActivity ??= { transition: Promise.resolve() });

function query(client: PoolClient, text: string) {
  // A disconnected server must not leave acquisition or release hanging.
  const config = { text, values: LOCK_KEYS, query_timeout: 2_000 };
  return client.query<{ locked: boolean }>(config);
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = state.transition.then(operation);
  state.transition = next.then(
    () => {},
    () => {},
  );
  return next;
}

async function release(lease: Lease, shared: boolean): Promise<void> {
  let destroy = lease.controller.signal.aborted;
  try {
    if (!destroy)
      await query(
        lease.client,
        shared ? 'SELECT pg_advisory_unlock_shared($1, $2)' : 'SELECT pg_advisory_unlock($1, $2)',
      );
  } catch {
    destroy = true;
  } finally {
    lease.client.removeListener('error', lease.onError);
    lease.client.release(destroy);
  }
}

async function connect(): Promise<Lease> {
  const client = await getDatabasePool().connect();
  const controller = new AbortController();
  const onError = () => controller.abort(new Error('Upload activity lock connection was lost'));
  client.on('error', onError);
  return { client, controller, references: 0, onError };
}

function wait(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 50);
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function acquire(signal: AbortSignal): Promise<Lease> {
  return serialize(async () => {
    signal.throwIfAborted();
    if (state.lease) {
      state.lease.controller.signal.throwIfAborted();
      state.lease.references++;
      return state.lease;
    }
    const lease = await connect();
    try {
      const waiting = AbortSignal.any([signal, lease.controller.signal]);
      while (true) {
        waiting.throwIfAborted();
        const result = await query(
          lease.client,
          'SELECT pg_try_advisory_lock_shared($1, $2) AS locked',
        );
        if (result.rows[0]?.locked) {
          waiting.throwIfAborted();
          lease.references = 1;
          state.lease = lease;
          return lease;
        }
        await wait(waiting);
      }
    } catch (error) {
      // Destroy rather than return a session that may have acquired the lock.
      lease.controller.abort();
      await release(lease, true);
      throw error;
    }
  });
}

/** One shared database lock connection protects every active TUS request in this process. */
export async function withTusActivity(
  request: Request,
  handle: (request: Request) => Promise<Response>,
): Promise<Response> {
  let lease: Lease;
  try {
    lease = await acquire(AbortSignal.any([request.signal, AbortSignal.timeout(WAIT_MS)]));
  } catch {
    return new Response('Uploads are temporarily unavailable. Retry shortly.', {
      status: 503,
      headers: { 'Retry-After': '1' },
    });
  }
  try {
    const signal = AbortSignal.any([request.signal, lease.controller.signal]);
    signal.throwIfAborted();
    // TUS consumes the body as a stream rather than using fetch, so explicitly
    // abort that stream as well as the signal when the lock session is lost.
    const body = request.body?.pipeThrough(new TransformStream(), { signal });
    return await handle(
      new Request(request, {
        signal,
        ...(body ? { body, duplex: 'half' } : {}),
      } as RequestInit),
    );
  } finally {
    await serialize(async () => {
      lease.references--;
      if (lease.references === 0) {
        await release(lease, true);
        if (state.lease === lease) state.lease = undefined;
      }
    });
  }
}

/** Nonblocking exclusive gate: cleanup never unlinks a file while a TUS request owns it. */
export async function withTusCleanup<T>(
  cleanup: (assertLock: () => void) => Promise<T>,
): Promise<T | null> {
  const lease = await connect();
  let locked = false;
  try {
    const result = await query(lease.client, 'SELECT pg_try_advisory_lock($1, $2) AS locked');
    locked = result.rows[0]?.locked === true;
    if (!locked) return null;
    const assertLock = () => lease.controller.signal.throwIfAborted();
    assertLock();
    return await cleanup(assertLock);
  } catch (error) {
    if (!locked) lease.controller.abort();
    throw error;
  } finally {
    if (locked) await release(lease, false);
    else {
      lease.client.removeListener('error', lease.onError);
      lease.client.release(lease.controller.signal.aborted);
    }
  }
}
