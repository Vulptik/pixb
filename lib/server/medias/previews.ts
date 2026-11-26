import { logger } from '@/lib/server/logger';

const MAX_CONCURRENT_PREVIEW_JOBS = 4;
let activePreviewJobs = 0;
const previewQueue: Array<() => void> = [];

function acquirePreviewSlot(): Promise<void> {
  if (activePreviewJobs < MAX_CONCURRENT_PREVIEW_JOBS) {
    activePreviewJobs++;
    return Promise.resolve();
  }
  return new Promise((resolve) => previewQueue.push(resolve));
}

function releasePreviewSlot(): void {
  const next = previewQueue.shift();
  if (next) {
    next();
  } else {
    activePreviewJobs--;
  }
}

export function enqueuePreviewJob(
  job: () => Promise<void>,
  context: Record<string, unknown>,
): void {
  setImmediate(async () => {
    await acquirePreviewSlot();
    try {
      await job();
    } catch (error) {
      logger.warn({ error, ...context }, 'Preview generation failed, continuing without preview');
    } finally {
      releasePreviewSlot();
    }
  });
}
