import { setImmediate as nextTurn } from 'node:timers/promises';
import { beforeEach, expect, it, vi } from 'vitest';
const warn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/server/logger', () => ({ logger: { warn } }));
beforeEach(() => {
  vi.resetModules();
  warn.mockReset();
});

it('limits concurrency to four and starts queued jobs in order as slots free', async () => {
  const { enqueuePreviewJob } = await import('@/lib/server/medias/previews');
  const started: number[] = [];
  const finish: Array<() => void> = [];
  for (let id = 0; id < 6; id++) {
    enqueuePreviewJob(
      async () => {
        started.push(id);
        await new Promise<void>((resolve) => {
          finish[id] = resolve;
        });
      },
      { id },
    );
  }
  await nextTurn();
  expect(started).toEqual([0, 1, 2, 3]);
  finish[1]();
  await nextTurn();
  expect(started).toEqual([0, 1, 2, 3, 4]);
  finish[0]();
  await nextTurn();
  expect(started).toEqual([0, 1, 2, 3, 4, 5]);
  for (const resolve of finish) resolve();
  await nextTurn();
  const later = vi.fn(async () => {});
  enqueuePreviewJob(later, {});
  await nextTurn();
  expect(later).toHaveBeenCalledOnce();
  expect(warn).not.toHaveBeenCalled();
});
it('logs failed previews with context and releases their slot for the next job', async () => {
  const { enqueuePreviewJob } = await import('@/lib/server/medias/previews');
  const error = new Error('bad media');
  const done = vi.fn(async () => {});
  enqueuePreviewJob(
    async () => {
      throw error;
    },
    { mediaId: '12' },
  );
  enqueuePreviewJob(done, {});
  await nextTurn();
  expect(warn).toHaveBeenCalledWith(
    { error, mediaId: '12' },
    'Preview generation failed, continuing without preview',
  );
  expect(done).toHaveBeenCalledOnce();
});
