import { getDatabasePool, prisma } from '@/lib/db/prisma';
import { logger } from '@/lib/server/logger';
import { rebuildUserCache } from '@/lib/server/medias/cache';
import { scanOrphanFiles } from '@/lib/server/orphanFiles';
import { cleanupStaleTusUploads } from '@/lib/server/tusStorage';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Two-key advisory locks have a separate namespace from the per-user bigint locks.
const LOCK_KEYS = [1_347_095_106, 1];
const intervals = { cleanup: HOUR, usage: DAY, orphans: DAY } as const;
type Job = keyof typeof intervals;
type MaintenanceResult = {
  status: 'completed' | 'busy' | 'disabled';
  completed: Job[];
  failed: Job[];
};
type SchedulerState = {
  timer?: ReturnType<typeof setInterval>;
  inFlight?: Promise<MaintenanceResult>;
  stopping: boolean;
};
const runtime = globalThis as typeof globalThis & { pixbMaintenance?: SchedulerState };
const state = (runtime.pixbMaintenance ??= { stopping: false });
const disabled = () => process.env.NEXT_PHASE === 'phase-production-build';
const keyFor = (job: Job) => `maintenance.${job}.last_success`;

async function cleanup() {
  const now = new Date();
  const [sessions, challenges, resets] = await prisma.$transaction([
    prisma.session.deleteMany({ where: { expires_at: { lt: now } } }),
    prisma.authChallenge.deleteMany({ where: { expires_at: { lt: now } } }),
    prisma.passwordReset.deleteMany({ where: { expires_at: { lt: now } } }),
  ]);
  const uploads = await cleanupStaleTusUploads();
  if (uploads === null) {
    logger.info('Temporary upload cleanup deferred while uploads are active; retrying next poll');
    return false;
  }
  logger.info(
    { sessions: sessions.count, challenges: challenges.count, resets: resets.count, uploads },
    'Expired temporary data cleaned',
  );
  return true;
}

async function reconcileUsage(assertLock: () => void) {
  let after: bigint | undefined;
  let reconciled = 0;
  while (!state.stopping) {
    assertLock();
    const users = await prisma.user.findMany({
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 100,
      ...(after === undefined ? {} : { where: { id: { gt: after } } }),
    });
    if (!users.length) break;
    for (const user of users) {
      assertLock();
      if (state.stopping) return;
      try {
        await rebuildUserCache(user.id);
        reconciled++;
      } catch (error) {
        // An account may be deleted after this batch was read.
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'P2025'))
          throw error;
      }
    }
    after = users[users.length - 1].id;
  }
  logger.info({ users: reconciled }, 'User storage usage reconciled');
}

async function reportOrphans() {
  const scan = await scanOrphanFiles();
  logger.info(
    {
      files: scan.items.length,
      bytes: scan.totalSize,
      scannedFiles: scan.scannedFiles,
      truncated: scan.truncated,
    },
    'Orphan file scan completed; files retained for manual review',
  );
}

async function execute(force: boolean): Promise<MaintenanceResult> {
  const result: MaintenanceResult = { status: 'completed', completed: [], failed: [] };
  const client = await getDatabasePool().connect();
  let locked = false;
  let connectionError: Error | undefined;
  const onError = (error: Error) => {
    connectionError = error;
  };
  const assertLock = () => {
    if (connectionError) throw new Error('Maintenance database lock connection was lost');
  };
  client.on('error', onError);
  try {
    const lock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      LOCK_KEYS,
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) return { ...result, status: 'busy' };
    const rows = await prisma.setting.findMany({
      where: { key: { in: (Object.keys(intervals) as Job[]).map(keyFor) } },
      select: { key: true, value: true },
    });
    const lastSuccess = new Map(rows.map(({ key, value }) => [key, Date.parse(value)]));
    for (const job of Object.keys(intervals) as Job[]) {
      if (state.stopping) break;
      assertLock();
      const previous = lastSuccess.get(keyFor(job));
      const now = Date.now();
      if (!force && previous && previous <= now && now - previous < intervals[job]) continue;
      try {
        await client.query('SELECT 1');
        assertLock();
        if (job === 'cleanup') {
          if (!(await cleanup())) {
            result.failed.push(job);
            continue;
          }
        } else if (job === 'usage') await reconcileUsage(assertLock);
        else await reportOrphans();
        if (state.stopping) break;
        await client.query('SELECT 1');
        assertLock();
        const value = new Date().toISOString();
        const key = keyFor(job);
        await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
        result.completed.push(job);
      } catch (error) {
        result.failed.push(job);
        logger.error({ job, error }, 'Automatic maintenance job failed; it will be retried');
      }
    }
    return result;
  } catch (error) {
    // A failed lock query can have succeeded on the server before the connection
    // failed. Never return a possibly locked session to the shared pool.
    connectionError = error instanceof Error ? error : new Error('Maintenance coordination failed');
    throw error;
  } finally {
    if (locked && !connectionError) {
      try {
        const unlocked = await client.query<{ unlocked: boolean }>(
          'SELECT pg_advisory_unlock($1, $2) AS unlocked',
          LOCK_KEYS,
        );
        if (unlocked.rows[0]?.unlocked !== true)
          connectionError = new Error('Maintenance database lock could not be released');
      } catch (error) {
        connectionError = error instanceof Error ? error : new Error('Maintenance unlock failed');
      }
    }
    client.removeListener('error', onError);
    client.release(connectionError);
  }
}

export async function runMaintenance({ force = false } = {}): Promise<MaintenanceResult> {
  if (disabled() || state.stopping) return { status: 'disabled', completed: [], failed: [] };
  if (state.inFlight) return { status: 'busy', completed: [], failed: [] };
  const pending = execute(force);
  state.inFlight = pending;
  try {
    return await pending;
  } finally {
    if (state.inFlight === pending) state.inFlight = undefined;
  }
}

export function startMaintenanceSchedule(): void {
  if (disabled() || state.timer) return;
  state.stopping = false;
  const tick = () => {
    void runMaintenance().catch((error) => logger.error({ error }, 'Automatic maintenance failed'));
  };
  state.timer = setInterval(tick, 60_000);
  state.timer.unref?.();
  tick();
}

export async function stopMaintenanceSchedule(): Promise<void> {
  state.stopping = true;
  if (state.timer) clearInterval(state.timer);
  state.timer = undefined;
  await state.inFlight;
}
