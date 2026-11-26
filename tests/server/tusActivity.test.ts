import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ getDatabasePool: () => ({ connect: mock.connect }) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let shared: Set<EventEmitter>;
let exclusive: EventEmitter | undefined;
let clients: Array<
  EventEmitter & { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }
>;
let activity: typeof import('@/lib/server/tusActivity');

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  delete (globalThis as typeof globalThis & { pixbTusActivity?: unknown }).pixbTusActivity;
  shared = new Set();
  exclusive = undefined;
  clients = [];
  mock.connect.mockReset().mockImplementation(async () => {
    const client = Object.assign(new EventEmitter(), {
      query: vi.fn(async (config: { text: string }) => {
        const sql = config.text;
        if (sql.includes('try_advisory_lock_shared')) {
          const locked = !exclusive;
          if (locked) shared.add(client);
          return { rows: [{ locked }] };
        }
        if (sql.includes('try_advisory_lock')) {
          const locked = !exclusive && shared.size === 0;
          if (locked) exclusive = client;
          return { rows: [{ locked }] };
        }
        if (sql.includes('unlock_shared')) shared.delete(client);
        else if (sql.includes('unlock') && exclusive === client) exclusive = undefined;
        return { rows: [] };
      }),
      release: vi.fn((destroy: boolean) => {
        if (destroy) {
          shared.delete(client);
          if (exclusive === client) exclusive = undefined;
        }
      }),
    });
    clients.push(client);
    return client;
  });
  activity = await import('@/lib/server/tusActivity');
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}
const request = () => new Request('http://localhost/files/upload');

describe('cross-process TUS activity gate', () => {
  it('uses one refcounted shared client and skips cleanup until every request finishes', async () => {
    const first = deferred<Response>(),
      second = deferred<Response>();
    const run1 = activity.withTusActivity(request(), () => first.promise);
    const run2 = activity.withTusActivity(request(), () => second.promise);
    await settle();
    expect(mock.connect).toHaveBeenCalledTimes(1);
    const cleanup = vi.fn(async () => 2);
    expect(await activity.withTusCleanup(cleanup)).toBeNull();
    expect(cleanup).not.toHaveBeenCalled();
    first.resolve(new Response('first'));
    await run1;
    expect(clients[0].release).not.toHaveBeenCalled();
    expect(await activity.withTusCleanup(cleanup)).toBeNull();
    second.resolve(new Response('second'));
    await run2;
    expect(clients[0].release).toHaveBeenCalledWith(false);
    expect(await activity.withTusCleanup(cleanup)).toBe(2);
  });

  it('makes a new request wait until exclusive cleanup completes before handling files', async () => {
    const done = deferred<number>();
    const cleanup = activity.withTusCleanup(() => done.promise);
    await settle();
    const handle = vi.fn(async () => new Response('ready'));
    const upload = activity.withTusActivity(request(), handle);
    await vi.advanceTimersByTimeAsync(100);
    expect(handle).not.toHaveBeenCalled();
    done.resolve(1);
    await cleanup;
    await vi.advanceTimersByTimeAsync(50);
    expect((await upload).status).toBe(200);
    expect(handle).toHaveBeenCalledOnce();
    expect(shared.size).toBe(0);
  });

  it('cancels a waiting request without entering its handler or leaking a client', async () => {
    const done = deferred<number>();
    const cleanup = activity.withTusCleanup(() => done.promise);
    await settle();
    const controller = new AbortController();
    const handle = vi.fn();
    const upload = activity.withTusActivity(
      new Request('http://localhost/files/id', { signal: controller.signal }),
      handle,
    );
    await settle();
    controller.abort();
    expect((await upload).status).toBe(503);
    expect(handle).not.toHaveBeenCalled();
    expect(clients[1].release).toHaveBeenCalledWith(true);
    done.resolve(0);
    await cleanup;
  });

  it('aborts active request signals and body reads when the shared lock connection is lost', async () => {
    let signal: AbortSignal | undefined;
    const upload = activity.withTusActivity(
      new Request('http://localhost/files/id', {
        method: 'PATCH',
        body: new ReadableStream(),
        duplex: 'half',
      } as RequestInit),
      async (protectedRequest) => {
        signal = protectedRequest.signal;
        await expect(protectedRequest.body!.getReader().read()).rejects.toThrow();
        return new Response('aborted', { status: 503 });
      },
    );
    await settle();
    clients[0].emit('error', new Error('connection lost'));
    expect((await upload).status).toBe(503);
    expect(signal?.aborted).toBe(true);
    expect(clients[0].release).toHaveBeenCalledWith(true);
  });

  it('releases the shared lock after a handler failure', async () => {
    await expect(
      activity.withTusActivity(request(), async () => {
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    expect(clients[0].release).toHaveBeenCalledWith(false);
    expect(shared.size).toBe(0);
  });

  it('releases exclusive locks on cleanup failure and detects lost cleanup sessions', async () => {
    await expect(
      activity.withTusCleanup(async () => {
        throw new Error('cleanup failed');
      }),
    ).rejects.toThrow('cleanup failed');
    expect(clients[0].release).toHaveBeenCalledWith(false);
    await expect(
      activity.withTusCleanup(async (assertLock) => {
        clients[1].emit('error', new Error('lost'));
        assertLock();
      }),
    ).rejects.toThrow('connection was lost');
    expect(clients[1].release).toHaveBeenCalledWith(true);
    expect(exclusive).toBeUndefined();
  });

  it('never starts a handler when the acquisition deadline has already expired', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new Error('timeout')));
    const handle = vi.fn();
    expect((await activity.withTusActivity(request(), handle)).status).toBe(503);
    expect(handle).not.toHaveBeenCalled();
    expect(mock.connect).not.toHaveBeenCalled();
  });

  it('destroys a client when shared or exclusive lock acquisition is ambiguous', async () => {
    const connect = mock.connect.getMockImplementation()!;
    const failQuery = async () => {
      const client = await connect();
      client.query.mockRejectedValueOnce(new Error('query timeout'));
      return client;
    };
    mock.connect.mockImplementationOnce(failQuery);
    const handle = vi.fn();
    expect((await activity.withTusActivity(request(), handle)).status).toBe(503);
    expect(handle).not.toHaveBeenCalled();
    expect(clients[0].release).toHaveBeenCalledWith(true);

    mock.connect.mockImplementationOnce(failQuery);
    await expect(activity.withTusCleanup(async () => 1)).rejects.toThrow('query timeout');
    expect(clients[1].release).toHaveBeenCalledWith(true);
  });

  it('destroys rather than pools a session whose unlock query fails', async () => {
    await activity.withTusActivity(request(), async () => {
      clients[0].query.mockRejectedValueOnce(new Error('unlock timeout'));
      return new Response('done');
    });
    expect(clients[0].release).toHaveBeenCalledWith(true);
    expect(shared.size).toBe(0);
  });
});
