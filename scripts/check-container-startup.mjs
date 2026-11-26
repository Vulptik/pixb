// Destructive scenarios run only in newly created containers with no host mounts.
// Only uses throwaway containers and volumes; never touches an existing installation.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { checkVideoPreviews } from './check-video-previews.mjs';

const image = process.argv[2] || process.env.PIXB_IMAGE || 'pixb:local';
const databaseImage = process.argv[3] || process.env.PIXB_DATABASE_IMAGE || 'pixb-postgres:local';
const prefix = `pixb-startup-${randomBytes(6).toString('hex')}`;
const network = `${prefix}-net`,
  accessNetwork = `${prefix}-access`,
  db = `${prefix}-db`,
  app = `${prefix}-app`;
const password = `${randomBytes(24).toString('hex')}@:/?#%`;
const jwt = randomBytes(32).toString('hex'),
  encryption = randomBytes(32).toString('hex');
const migrations = readdirSync('prisma/migrations', { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const pause = () => new Promise((resolve) => setTimeout(resolve, 500));
function docker(args, input) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || 'Docker command failed');
  // Docker forwards container stderr to its own stderr, even when logs succeeds.
  return (result.stdout + (args[0] === 'logs' ? result.stderr : '')).trim();
}
function sql(database, text) {
  return docker(
    ['exec', '-i', db, 'psql', '-U', 'pixb', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At'],
    text,
  );
}
function appEnv(database, recovery = false) {
  return [
    '-e',
    `DATABASE_HOST=${db}`,
    '-e',
    'POSTGRES_USER=pixb',
    '-e',
    `POSTGRES_PASSWORD=${password}`,
    '-e',
    `POSTGRES_DB=${database}`,
    '-e',
    `JWT_SECRET=${jwt}`,
    '-e',
    `ENCRYPTION_KEY=${encryption}`,
    '-e',
    `RECOVERY_MODE=${recovery}`,
    '-e',
    'PUBLIC_URL=http://localhost',
  ];
}
function launch(database, recovery = false, offline = false) {
  docker([
    'run',
    '-d',
    '--name',
    app,
    '--network',
    network,
    '-p',
    '127.0.0.1::3000',
    ...appEnv(database, recovery),
    image,
  ]);
  // Docker does not publish host ports on an internal-only network. Add host
  // access only after the first startup has been verified without internet.
  if (!offline) docker(['network', 'connect', accessNetwork, app]);
}
async function healthyOffline() {
  for (let i = 0; i < 120; i++) {
    if (docker(['inspect', '--format', '{{.State.Running}}', app]) !== 'true') {
      throw new Error(`Offline startup failed: ${docker(['logs', app])}`);
    }
    try {
      docker([
        'exec',
        app,
        'node',
        '-e',
        "require('node:http').get('http://127.0.0.1:3000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))",
      ]);
      return;
    } catch {
      await pause();
    }
  }
  throw new Error(`Offline startup timed out: ${docker(['logs', app])}`);
}
async function healthy() {
  if (docker(['inspect', '--format', '{{.State.Running}}', app]) !== 'true') {
    throw new Error(`App exited during startup: ${docker(['logs', app])}`);
  }
  const port = docker(['port', app, '3000/tcp']).split(':').at(-1);
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    if (docker(['inspect', '--format', '{{.State.Running}}', app]) !== 'true') {
      throw new Error(`App exited during startup: ${docker(['logs', app])}`);
    }
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return origin;
    } catch {
      /* server not listening yet */
    }
    await pause();
  }
  throw new Error('App did not become healthy within 60 seconds.');
}
async function refused(message) {
  for (let i = 0; i < 120; i++) {
    if (docker(['inspect', '--format', '{{.State.Running}}', app]) === 'false') {
      assert.notEqual(docker(['inspect', '--format', '{{.State.ExitCode}}', app]), '0');
      assert.match(docker(['logs', app]), message);
      return;
    }
    await pause();
  }
  throw new Error('Unsafe startup was not refused within 60 seconds.');
}
function removeApp() {
  docker(['rm', '-f', app]);
}
async function post(origin, path, body) {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
}

try {
  // Installation and migration must not need outbound internet access.
  docker(['network', 'create', '--internal', network]);
  docker(['network', 'create', accessNetwork]);
  docker([
    'run',
    '-d',
    '--name',
    db,
    '--network',
    network,
    '--mount',
    'type=tmpfs,destination=/var/lib/postgresql',
    '-e',
    'POSTGRES_USER=pixb',
    '-e',
    `POSTGRES_PASSWORD=${password}`,
    '-e',
    'POSTGRES_DB=fresh',
    databaseImage,
  ]);
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      sql('fresh', 'SELECT 1;');
      ready = true;
      break;
    } catch {
      await pause();
    }
  }
  assert.ok(ready, 'Disposable PostgreSQL became ready');

  launch('fresh', false, true);
  await healthyOffline();
  console.log('PASS fresh migrations and healthy startup without outbound internet');
  docker(['network', 'connect', accessNetwork, app]);
  let origin = await healthy();
  assert.equal(sql('fresh', 'SELECT COUNT(*) FROM users;'), '0');
  const create = await post(origin, '/api/v1/setup', {
    admin: {
      username: 'startuptester',
      email: 'startup@example.invalid',
      password: 'Container-Test-Password-2026!',
      password_confirmation: 'Container-Test-Password-2026!',
    },
  });
  assert.equal(create.status, 201, await create.text());
  assert.equal(sql('fresh', 'SELECT COUNT(*) FROM users;'), '1');
  assert.equal(sql('fresh', 'SELECT quota FROM users;'), '0');
  const quotaCheck = await fetch(`${origin}/api/v1/user/check_quota`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: create.headers.get('set-cookie').split(';')[0],
    },
    body: JSON.stringify({ size: 2 * 1024 ** 3 }),
  });
  assert.equal((await quotaCheck.json()).allowed, true);
  const cookie = create.headers.get('set-cookie').split(';')[0];
  assert.doesNotMatch(create.headers.get('set-cookie'), /;\s*Secure/i);
  const upload = async (bytes, name, type) => {
    const form = new FormData();
    form.set('file', new File([bytes], name, { type }));
    const response = await fetch(`${origin}/api/v1/uploads`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: form,
    });
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).file;
  };
  const preview = async (link) => {
    assert.ok(link);
    const pathname = new URL(link, origin).pathname;
    for (let i = 0; i < 80; i++) {
      const response = await fetch(`${origin}${pathname}`, { headers: { Cookie: cookie } });
      if (response.ok) {
        assert.match(response.headers.get('content-type'), /^image\/webp/);
        assert.ok((await response.arrayBuffer()).byteLength > 8);
        return;
      }
      await pause();
    }
    throw new Error(`No generated preview for ${pathname}: ${docker(['logs', app])}`);
  };
  const png = Buffer.from(
    docker([
      'exec',
      app,
      'node',
      '-e',
      "require('sharp')({create:{width:96,height:64,channels:3,background:'#d7ac67'}}).png().toBuffer().then(x=>console.log(x.toString('base64')))",
    ]),
    'base64',
  );
  const picture = await upload(png, 'packaging.png', 'image/png');
  await preview(picture.links.thumbnail);
  await checkVideoPreviews(origin, cookie);
  const login = await fetch(`${origin}/login`);
  assert.equal(login.status, 200);
  const staticAsset = (await login.text()).match(
    /(?:src|href)="([^"\s]*\/_next\/static\/[^"\s]+)"/,
  );
  assert.ok(staticAsset, 'Production page includes a built JS/CSS asset');
  assert.equal((await fetch(new URL(staticAsset[1], origin))).status, 200);
  console.log(
    'PASS Sharp image previews, FFmpeg video thumbnails/posters, original bytes, and static assets',
  );
  const readSettings = async () =>
    (await (await fetch(`${origin}/api/v1/instance`, { headers: { Cookie: cookie } })).json())
      .settings;
  assert.deepEqual(
    [(await readSettings()).publicUrl, (await readSettings()).publicUrlOverride],
    ['http://localhost', ''],
  );
  for (const [override, effective] of [
    ['https://photos.example.invalid', 'https://photos.example.invalid'],
    ['', 'http://localhost'],
  ]) {
    const response = await fetch(`${origin}/api/v1/instance`, {
      method: 'PATCH',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ settings: { publicUrl: override } }),
    });
    assert.equal(response.status, 200);
    assert.equal((await readSettings()).publicUrl, effective);
    assert.equal((await readSettings()).publicUrlOverride, override);
  }
  const proxyLogin = await fetch(`${origin}/api/v1/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-host': 'photos.example.invalid',
      'x-forwarded-proto': 'https',
    },
    body: JSON.stringify({
      user: { login: 'startuptester', password: 'Container-Test-Password-2026!' },
    }),
  });
  assert.equal(proxyLogin.status, 200);
  assert.match(proxyLogin.headers.get('set-cookie'), /;\s*Secure/i);
  console.log(
    'PASS installation address fallback, custom override/reset, LAN HTTP and HTTPS-proxy session cookie flags',
  );
  sql('fresh', 'UPDATE users SET quota = 12;');
  assert.equal(
    sql('fresh', 'SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;'),
    String(migrations.length),
  );
  console.log('PASS fresh image startup, migrations, HTTP setup, no development seeding');
  docker(['restart', app]);
  origin = await healthy();
  assert.equal(sql('fresh', 'SELECT COUNT(*) FROM users;'), '1');
  console.log('PASS restart preserves administrator and migration history');
  assert.equal(sql('fresh', 'SELECT quota FROM users;'), '12');
  removeApp();

  launch('fresh', true);
  await refused(/Recovery was not armed/);
  removeApp();
  docker([
    'run',
    '--rm',
    '--network',
    network,
    ...appEnv('fresh'),
    '--entrypoint',
    'node',
    image,
    'docker/db-check.js',
    'arm-recovery',
  ]);
  launch('fresh', true);
  origin = await healthy();
  const results = await Promise.all(
    [0, 1].map((n) =>
      post(origin, '/api/v1/recover', {
        password: `Recovered-Password-${n}-2026!`,
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 403]);
  assert.equal(sql('fresh', 'SELECT COUNT(*) FROM sessions;'), '0');
  assert.equal(sql('fresh', "SELECT value FROM settings WHERE key='recovery.used';"), 'true');
  docker(['restart', app]);
  origin = await healthy();
  assert.equal((await (await fetch(`${origin}/api/v1/recover`)).json()).available, false);
  const winner = results.findIndex((response) => response.status === 200);
  assert.equal(
    (
      await post(origin, '/api/v1/sessions', {
        user: {
          login: 'startuptester',
          password: `Recovered-Password-${winner}-2026!`,
        },
      })
    ).status,
    200,
  );
  assert.equal(
    (await post(origin, '/api/v1/recover', { password: 'Another-Password-2026!' })).status,
    403,
  );
  console.log(
    'PASS unarmed recovery refused; explicit arming works; concurrent reset consumed once; restart does not rearm',
  );
  removeApp();

  sql('fresh', 'CREATE DATABASE untracked; CREATE DATABASE failed; CREATE DATABASE legacy;');
  sql('untracked', "CREATE TABLE sentinel (value text); INSERT INTO sentinel VALUES ('preserve');");
  launch('untracked');
  await refused(/no Prisma history/);
  assert.equal(sql('untracked', 'SELECT value FROM sentinel;'), 'preserve');
  assert.equal(sql('untracked', "SELECT to_regclass('public._prisma_migrations') IS NULL;"), 't');
  console.log('PASS untracked schema preserved without a users table or auto-baseline');
  removeApp();

  sql(
    'failed',
    `CREATE TABLE sentinel (value text); INSERT INTO sentinel VALUES ('preserve');
    CREATE TABLE users (id integer);
    CREATE TABLE _prisma_migrations (migration_name text, checksum text, finished_at timestamp, rolled_back_at timestamp);
    INSERT INTO _prisma_migrations VALUES ('${migrations[0]}', 'fixture', NULL, NULL);`,
  );
  launch('failed');
  await refused(/failed or was interrupted/);
  assert.equal(sql('failed', 'SELECT value FROM sentinel;'), 'preserve');
  assert.equal(sql('failed', 'SELECT finished_at IS NULL FROM _prisma_migrations;'), 't');
  console.log('PASS failed initial migration preserves data even with an empty users table');
  removeApp();

  // Minimal former-project fixture. The initial schema must never reshape it.
  sql(
    'legacy',
    `CREATE TABLE users (username text);
    CREATE TABLE folders (id bigint);
    INSERT INTO users VALUES ('legacy');
    CREATE TABLE _prisma_migrations (
    id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz,
    migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz,
    started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0);
    INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count)
    VALUES ('former-project', 'old', '20260507190000_init', now(), 1);`,
  );
  launch('legacy');
  await refused(/newer than or different/);
  assert.equal(sql('legacy', 'SELECT username FROM users;'), 'legacy');
  assert.equal(sql('legacy', "SELECT to_regclass('public.folders') IS NOT NULL;"), 't');
  console.log(
    'PASS former database history refused by startup preflight without deleting its users or folder schema',
  );
} finally {
  // Only these randomly named resources belong to this run. No volume deletion,
  // host filesystem cleanup, global prune, or existing Compose project actions.
  for (const name of [app, db]) {
    try {
      docker(['rm', '-f', name]);
    } catch {
      /* absent or already removed */
    }
  }
  for (const name of [network, accessNetwork]) {
    try {
      docker(['network', 'rm', name]);
    } catch {
      /* absent */
    }
  }
}
