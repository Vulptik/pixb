import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { prisma } from '../lib/db/prisma';
import { hashToken, signSessionToken } from '../lib/server/auth';
import { deleteLibraryFile } from '../lib/server/library';
import { getMediaStorageDir } from '../lib/server/storagePaths';
import type { LibraryFile } from '../types/library';

// Never point this workload or its fixture cleanup at an installed instance.
const database = new URL(process.env.DATABASE_URL || 'file:///missing');
assert.equal(process.env.PIXB_LOCAL_DEV, '1');
assert.equal(database.hostname, '127.0.0.1');
assert.equal(database.port, '5435');
assert.equal(database.pathname, '/pixb');
assert.equal(path.resolve(process.env.STORAGE_PATH || ''), path.resolve('storage'));
const base = 'http://127.0.0.1:3002';
const runId = randomUUID();
const output = path.resolve(
  '.local-rebuild/performance',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
const sessions: bigint[] = [];
const adminFiles: bigint[] = [];
const adminCollections: bigint[] = [];
let syntheticUser: { id: bigint; email: string } | undefined;
let server: ReturnType<typeof spawn> | undefined;
const env = { ...process.env, PIXB_PERF_BUILD: '1', PUBLIC_URL: base };
const results: Record<string, unknown> = {
  recordedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: `${os.platform()} ${os.release()}`,
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    memoryGiB: Math.round(os.totalmem() / 1024 ** 3),
    mode: 'production, loopback network, isolated development PostgreSQL',
  },
  limitations: [
    'Local lab results, not field Core Web Vitals or a NAS/phone certification.',
    'API scale fixtures contain metadata only; browser fixtures are actual generated PNG files.',
    'Read workloads use warm application/database caches and measure complete response bodies.',
    'Lighthouse simulates mobile CPU/network conditions; it does not measure sustained animation FPS or real INP.',
    'Upload timings cover PNG acceptance; background preview work is measured separately by first thumbnail requests.',
    'Video transcoding, large resumable uploads, WAN latency and multi-user saturation are not covered.',
  ],
};
type Timing = {
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  requests: number;
  errors: number;
  requestsPerSecond: number;
};
type Audit = {
  name: string;
  motion: 'normal' | 'reduced';
  score: number | null;
  lcpMs?: number;
  fcpMs?: number;
  tbtMs?: number;
  cls?: number;
  transferBytes?: number;
  warnings: unknown;
  opportunities: unknown;
};
const api: Array<{ files: number; name: string; concurrency: number } & Timing> = [];
const audits: Audit[] = [];
results.api = api;
results.audits = audits;

function command(args: string[], logName: string, extraEnv = env): Promise<void> {
  return new Promise((resolve, reject) => {
    const log = createWriteStream(path.join(output, logName));
    const child = spawn(process.execPath, args, {
      env: extraEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    child.once('error', (error) => {
      log.end();
      reject(error);
    });
    child.once('exit', (code) => {
      log.end();
      if (code === 0) resolve();
      else reject(new Error(`${logName}: exit ${code}; see ${output}`));
    });
  });
}
function summary(values: number[], elapsed: number, errors = 0): Timing {
  const sorted = [...values].sort((a, b) => a - b);
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    medianMs: round(sorted[Math.ceil(sorted.length * 0.5) - 1] || 0),
    p95Ms: round(sorted[Math.ceil(sorted.length * 0.95) - 1] || 0),
    maxMs: round(sorted.at(-1) || 0),
    requests: values.length,
    errors,
    requestsPerSecond: round(values.length / (elapsed / 1000)),
  };
}
async function request(route: string, cookie: string, init: RequestInit = {}) {
  // API upload links may include the installation's stored PUBLIC_URL override.
  // Always exercise this run's own loopback server.
  const target = new URL(route, base);
  return fetch(base + target.pathname + target.search, {
    ...init,
    headers: { cookie, ...init.headers },
    signal: AbortSignal.timeout(30000),
  });
}
async function timeReads(route: string, cookie: string, concurrency = 1, count = 40) {
  for (let i = 0; i < 3; i++) {
    const warm = await request(route, cookie);
    assert.equal(warm.status, 200, `${route} warmup failed`);
    await warm.arrayBuffer();
  }
  const values: number[] = [];
  let next = 0,
    errors = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next++ < count) {
        const at = performance.now();
        try {
          const response = await request(route, cookie);
          await response.arrayBuffer();
          if (!response.ok) errors++;
        } catch {
          errors++;
        }
        values.push(performance.now() - at);
      }
    }),
  );
  return summary(values, performance.now() - started, errors);
}
async function session(userId: bigint) {
  const raw = randomBytes(32).toString('hex');
  const record = await prisma.session.create({
    data: {
      user_id: userId,
      token: hashToken(raw),
      ip_address: '127.0.0.1',
      user_agent: 'PixB local performance benchmark',
      expires_at: new Date(Date.now() + 3600000),
    },
  });
  sessions.push(record.id);
  return `pixb_session=${signSessionToken({ session_token: raw, user_id: userId.toString(), session_id: record.id.toString(), exp: Math.floor(record.expires_at.getTime() / 1000) })}`;
}
async function assertFreePort() {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(3002, '127.0.0.1', resolve);
  });
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
}
async function start() {
  await assertFreePort();
  if (!process.argv.includes('--skip-build')) {
    console.log('Building an isolated production copy...');
    const before = await readFile('tsconfig.json', 'utf8');
    try {
      await command(['node_modules/next/dist/bin/next', 'build', '--webpack'], 'build.log');
    } finally {
      // Next adds its alternative output's generated types to tsconfig. Restore
      // only that generated edit, retaining any concurrent semantic changes.
      const original = JSON.parse(before);
      const current = JSON.parse(await readFile('tsconfig.json', 'utf8'));
      current.include = current.include?.filter(
        (entry: string) =>
          ![
            '.next-pixb/performance/types/**/*.ts',
            '.next-pixb/performance/dev/types/**/*.ts',
          ].includes(entry) || original.include?.includes(entry),
      );
      if (JSON.stringify(current) === JSON.stringify(original))
        await writeFile('tsconfig.json', before);
    }
  }
  const log = createWriteStream(path.join(output, 'server.log'));
  server = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3002'],
    {
      env: { ...env, NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  server.stdout?.pipe(log, { end: false });
  server.stderr?.pipe(log, { end: false });
  server.once('exit', () => log.end());
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error('Benchmark server stopped; see server.log');
    try {
      if ((await fetch(base + '/api/v1/health', { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* Starting. */
    }
    await delay(500);
  }
  throw new Error('Benchmark server did not become healthy');
}
async function scaleReads() {
  console.log('Measuring authenticated reads at 100, 1,000 and 10,000 files...');
  syntheticUser = await prisma.user.create({
    data: {
      email: `benchmark-${runId}@pixb.local`,
      username: `bench_${runId.slice(0, 8)}`,
      password_digest: 'benchmark account has no usable password',
    },
    select: { id: true, email: true },
  });
  const cookie = await session(syntheticUser.id);
  const collections = await prisma.collection.createManyAndReturn({
    data: Array.from({ length: 100 }, (_, i) => ({
      name: `Benchmark ${i + 1}`,
      user_id: syntheticUser!.id,
    })),
    select: { id: true },
  });
  let existing = 0;
  for (const size of [100, 1000, 10000]) {
    while (existing < size) {
      const records = Array.from({ length: Math.min(500, size - existing) }, (_, j) => {
        const i = existing + j;
        return {
          user_id: syntheticUser!.id,
          uid: `bench-${runId}-${i}`,
          filename: `Benchmark ${i % 10 === 0 ? 'sunset' : 'archive'} ${String(i).padStart(5, '0')}.txt`,
          mime_type: 'text/plain',
          size: 128n,
          file_data: path.join(
            storageRoot,
            syntheticUser!.id.toString(),
            'media',
            `metadata-only-${i}.txt`,
          ),
          is_favorite: i % 5 === 0,
          is_shared: i % 7 === 0,
          created_at: new Date(Date.now() - i * 1000),
        };
      });
      const rows = await prisma.media.createManyAndReturn({ data: records, select: { id: true } });
      await prisma.collectionMedia.createMany({
        data: rows.map((m, i) => ({
          media_id: m.id,
          collection_id: collections[(existing + i) % collections.length].id,
          user_id: syntheticUser!.id,
        })),
      });
      existing += records.length;
    }
    // Bulk fixtures need representative planner statistics immediately, rather
    // than depending on the local autovacuum schedule between benchmark runs.
    await prisma.$executeRaw`ANALYZE medias, collections, collection_medias`;
    const scenarios = [
      ['Library first page', '/api/v1/medias'],
      ['Library last page', `/api/v1/medias?page=${Math.ceil(size / 40)}`],
      ['Search', '/api/v1/medias?q=sunset'],
      ['Favorites', '/api/v1/medias?favorite=true'],
      ['Shared', '/api/v1/medias?shared=true'],
      ['Type filter', '/api/v1/medias?type=document'],
      ['Collection files', `/api/v1/medias?collection=${collections[0].id}`],
      ['100 collection covers/counts', '/api/v1/collections'],
    ];
    for (const [name, route] of scenarios) {
      const timing = await timeReads(route, cookie);
      api.push({ files: size, name, concurrency: 1, ...timing });
      console.log(
        `${size} files | ${name}: median ${timing.medianMs}ms, p95 ${timing.p95Ms}ms, errors ${timing.errors}`,
      );
    }
    const timing = await timeReads('/api/v1/medias', cookie, 8, 160);
    api.push({ files: size, name: 'Library first page', concurrency: 8, ...timing });
  }
}
let storageRoot: string;
async function browserFixtures(cookie: string) {
  console.log('Creating 24 real PNG fixtures for the browser audits...');
  const files: LibraryFile[] = [];
  const timings: number[] = [];
  const started = performance.now();
  for (let i = 0; i < 24; i++) {
    const hue = (i * 29) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="hsl(${hue} 35% 65%)"/><circle cx="1200" cy="230" r="140" fill="#ead6ac"/><path d="M0 1000V700L500 180L1000 900L1350 450L1600 700V1000" fill="hsl(${hue} 25% 28%)"/></svg>`;
    const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
    const body = new FormData();
    body.set(
      'file',
      new File([new Uint8Array(bytes)], `Benchmark ${runId} ${i}.png`, { type: 'image/png' }),
    );
    const at = performance.now();
    const response = await request('/api/v1/uploads', cookie, { method: 'POST', body });
    assert.equal(response.status, 201, `Fixture upload ${i}: ${await response.clone().text()}`);
    const data = (await response.json()) as { file: LibraryFile };
    adminFiles.push(BigInt(data.file.id));
    files.push(data.file);
    timings.push(performance.now() - at);
  }
  results.uploadPng = summary(timings, performance.now() - started);
  const thumbnail: number[] = [];
  for (const file of files) {
    const at = performance.now();
    const response = await request(file.links.thumbnail!, cookie);
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    thumbnail.push(performance.now() - at);
  }
  results.firstThumbnailRequests = summary(
    thumbnail,
    thumbnail.reduce((a, b) => a + b, 0),
  );
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: 'admin@pixb.local' },
    select: { id: true },
  });
  for (let i = 0; i < 4; i++) {
    const collection = await prisma.collection.create({
      data: { name: `Benchmark ${i + 1}`, user_id: user.id },
    });
    adminCollections.push(collection.id);
    await prisma.collectionMedia.createMany({
      data: files.slice(i * 6, i * 6 + 6).map((file) => ({
        collection_id: collection.id,
        media_id: BigInt(file.id),
        user_id: user.id,
      })),
    });
  }
  await prisma.media.update({ where: { id: BigInt(files[0].id) }, data: { is_shared: true } });
  await prisma.media.updateMany({
    where: { id: { in: adminFiles.slice(0, 6) } },
    data: { is_favorite: true },
  });
  return {
    share: new URL(files[0].links.share, base).pathname,
    collection: `/collections/${adminCollections[0]}`,
  };
}
async function lighthouse(cookie: string, fixtures: { share: string; collection: string }) {
  if (process.argv.includes('--skip-browser')) return;
  const npmCli =
    process.env.npm_execpath ||
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  assert.ok(existsSync(npmCli), 'Run through npm run benchmark:local so npm can launch Lighthouse');
  const headersFile = path.join(output, '.headers.json');
  await writeFile(headersFile, JSON.stringify({ Cookie: cookie }), { mode: 0o600 });
  const browserEnv = {
    ...env,
    CHROME_PATH: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  };
  const cases: Array<{
    name: string;
    route: string;
    desktop: boolean;
    authenticated: boolean;
    reducedMotion?: boolean;
  }> = [
    ...(process.argv.includes('--quick') ? [1] : [1, 2, 3]).flatMap((n) => [
      { name: `library-desktop-${n}`, route: '/', desktop: true, authenticated: true },
      { name: `library-mobile-${n}`, route: '/', desktop: false, authenticated: true },
    ]),
    { name: 'collections-desktop', route: '/collections', desktop: true, authenticated: true },
    { name: 'settings-desktop', route: '/settings', desktop: true, authenticated: true },
    { name: 'login-mobile', route: '/login', desktop: false, authenticated: false },
    { name: 'public-share-mobile', route: fixtures.share, desktop: false, authenticated: false },
    ...(process.argv.includes('--all-pages')
      ? [
          {
            name: 'collections-mobile',
            route: '/collections',
            desktop: false,
            authenticated: true,
          },
          { name: 'settings-mobile', route: '/settings', desktop: false, authenticated: true },
          { name: 'favorites-desktop', route: '/favorites', desktop: true, authenticated: true },
          { name: 'favorites-mobile', route: '/favorites', desktop: false, authenticated: true },
          {
            name: 'collection-desktop',
            route: fixtures.collection,
            desktop: true,
            authenticated: true,
          },
          {
            name: 'collection-mobile',
            route: fixtures.collection,
            desktop: false,
            authenticated: true,
          },
          { name: 'login-desktop', route: '/login', desktop: true, authenticated: false },
          {
            name: 'public-share-desktop',
            route: fixtures.share,
            desktop: true,
            authenticated: false,
          },
        ]
      : []),
  ];
  const auditFilter = process.argv.find((arg) => arg.startsWith('--audit='))?.slice(8);
  const matchedCases = cases.filter((audit) => !auditFilter || audit.name.includes(auditFilter));
  const selectedCases = process.argv.includes('--compare-motion')
    ? matchedCases.flatMap((audit) => [
        audit,
        { ...audit, name: `${audit.name}-reduced-motion`, reducedMotion: true },
      ])
    : matchedCases;
  assert.ok(selectedCases.length, `No audits match ${auditFilter}`);
  try {
    for (const audit of selectedCases) {
      console.log(`Lighthouse ${audit.name}...`);
      const prefix = path.join(output, audit.name);
      await command(
        [
          npmCli,
          'exec',
          '--yes',
          '--package=lighthouse@13.6.0',
          '--',
          'lighthouse',
          base + audit.route,
          '--only-categories=performance',
          '--output=json',
          '--output=html',
          `--output-path=${prefix}`,
          '--quiet',
          `--chrome-flags=--headless=new --no-first-run --no-default-browser-check${audit.reducedMotion ? ' --force-prefers-reduced-motion' : ''}`,
          '--blocked-url-patterns=https://*',
          ...(audit.desktop ? ['--preset=desktop'] : []),
          ...(audit.authenticated ? [`--extra-headers=${headersFile}`] : []),
        ],
        `${audit.name}.log`,
        browserEnv,
      );
      // Lighthouse embeds configuration in its reports. Never retain authentication headers.
      for (const extension of ['json', 'html']) {
        const file = `${prefix}.report.${extension}`;
        const content = await readFile(file, 'utf8');
        await writeFile(
          file,
          content
            .replaceAll(cookie, '[REDACTED]')
            .replaceAll(cookie.slice('pixb_session='.length), '[REDACTED]')
            // The application can refresh the session JWT during an audit.
            .replace(/pixb_session=[A-Za-z0-9._-]+/g, 'pixb_session=[REDACTED]')
            .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]'),
        );
      }
      const report = JSON.parse(await readFile(`${prefix}.report.json`, 'utf8'));
      assert.ok(!report.runtimeError, `${audit.name}: ${JSON.stringify(report.runtimeError)}`);
      assert.equal(
        new URL(report.finalDisplayedUrl || report.finalUrl).pathname,
        audit.route,
        'Audit unexpectedly redirected',
      );
      const a = report.audits;
      const entry: Audit = {
        name: audit.name,
        motion: audit.reducedMotion ? 'reduced' : 'normal',
        score: report.categories.performance.score,
        lcpMs: a['largest-contentful-paint']?.numericValue,
        fcpMs: a['first-contentful-paint']?.numericValue,
        tbtMs: a['total-blocking-time']?.numericValue,
        cls: a['cumulative-layout-shift']?.numericValue,
        transferBytes: a['total-byte-weight']?.numericValue,
        warnings: report.runWarnings,
        opportunities: Object.values(a)
          .filter((item: unknown) => {
            const a = item as { score?: number; details?: { type?: string } };
            return a.score != null && a.score < 0.9 && a.details?.type === 'opportunity';
          })
          .map((item: unknown) => {
            const a = item as { id: string; title: string; displayValue: string };
            return { id: a.id, title: a.title, display: a.displayValue };
          }),
      };
      audits.push(entry);
      console.log(
        `${audit.name}: ${Math.round((entry.score || 0) * 100)}/100, LCP ${Math.round(entry.lcpMs || 0)}ms, TBT ${Math.round(entry.tbtMs || 0)}ms`,
      );
      await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    }
  } finally {
    await rm(headersFile, { force: true });
  }
}
async function cleanup() {
  // Remove only IDs allocated by this run; preserve the permanent admin and all existing data.
  for (const id of adminFiles) {
    const file = await prisma.media.findUnique({ where: { id } });
    if (file?.filename.includes(runId)) await deleteLibraryFile(file.user_id, id);
  }
  if (adminCollections.length)
    await prisma.collection.deleteMany({ where: { id: { in: adminCollections } } });
  if (sessions.length) await prisma.session.deleteMany({ where: { id: { in: sessions } } });
  if (syntheticUser)
    await prisma.user.deleteMany({ where: { id: syntheticUser.id, email: syntheticUser.email } });
}
async function main() {
  await mkdir(output, { recursive: true });
  storageRoot = await getMediaStorageDir();
  try {
    await start();
    if (!process.argv.includes('--skip-api')) await scaleReads();
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: 'admin@pixb.local' },
      select: { id: true, role: true },
    });
    assert.equal(
      admin.role,
      1,
      'Prepare the permanent development admin first with npm run local:prepare',
    );
    const cookie = await session(admin.id);
    const share = await browserFixtures(cookie);
    await lighthouse(cookie, share);
  } catch (error) {
    results.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
    console.error(results.error);
  } finally {
    try {
      await cleanup();
      results.cleanup = 'All fixtures and benchmark sessions removed; permanent admin preserved';
    } catch (error) {
      results.cleanup = String(error);
      process.exitCode = 1;
    }
    server?.kill();
    await prisma.$disconnect();
    await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    const rows = api
      .map(
        (r) =>
          `| ${r.files} | ${r.name} | ${r.concurrency} | ${r.medianMs} | ${r.p95Ms} | ${r.errors} |`,
      )
      .join('\n');
    const pageRows = audits
      .map(
        (a) =>
          `| ${a.name} | ${Math.round((a.score || 0) * 100)} | ${Math.round(a.lcpMs || 0)} | ${Math.round(a.tbtMs || 0)} | ${(a.cls || 0).toFixed(3)} |`,
      )
      .join('\n');
    await writeFile(
      path.join(output, 'summary.md'),
      `# PixB local performance baseline\n\n${JSON.stringify(results.environment)}\n\n## Authenticated APIs\n\n| Files | Scenario | Concurrency | Median ms | p95 ms | Errors |\n| --- | --- | --- | --- | --- | --- |\n${rows}\n\n## Lighthouse\n\n| Page | Score | LCP ms | TBT ms | CLS |\n| --- | --- | --- | --- | --- |\n${pageRows}\n\n## Limits\n\n${(results.limitations as string[]).map((s) => `- ${s}`).join('\n')}\n\nCleanup: ${results.cleanup}\n`,
    );
    console.log(`Reports: ${output}`);
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
