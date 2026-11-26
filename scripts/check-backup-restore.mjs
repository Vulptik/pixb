// Isolated, synthetic installations only; never selects existing projects/data.
import { spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { TOTP, Secret } from 'otpauth';
import { main, verify } from './backup.mjs';

const source = `pixb-backup-test-${randomBytes(6).toString('hex')}`;
const args = process.argv.slice(2);
const upgrade = args[0] === '--upgrade';
if (upgrade && (args.length !== 4 || args.slice(1).some((ref) => !ref || ref.startsWith('-')))) {
  throw new Error(
    'Usage: node scripts/check-backup-restore.mjs --upgrade OLD_IMAGE NEW_IMAGE POSTGRES_IMAGE',
  );
}
const image = (upgrade ? args[1] : args[0]) || process.env.PIXB_IMAGE || 'pixb:local';
const env = {
  ...process.env,
  PUBLIC_URL: 'http://localhost',
  PIXB_IMAGE: image,
  PIXB_DATABASE_IMAGE:
    (upgrade ? args[3] : args[1]) || process.env.PIXB_DATABASE_IMAGE || 'pixb-postgres:local',
  PIXB_PORT: '0',
  PIXB_BIND_ADDRESS: '127.0.0.1',
};
const root = path.resolve('.local-rebuild');
mkdirSync(root, { recursive: true });
const work = mkdtempSync(path.join(root, 'backup-drill-'));
const backup = path.join(work, 'complete');
const projects = new Set();
const log = console.log;
// Track each freshly claimed restore project, including failures, for test-only cleanup.
console.log = (...args) => {
  const match = String(args[0]).match(/fresh project (pixb-restore-[a-f0-9]{12})/);
  if (match) projects.add(match[1]);
  log(...args);
};
function docker(args, input) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    input,
    env,
    maxBuffer: 8 * 1024 ** 2,
  });
  if (result.error || result.status !== 0)
    throw new Error(result.stderr || 'Docker drill command failed');
  return result.stdout.trim();
}
function compose(project, args) {
  return docker(['compose', '-p', project, '-f', 'compose.production.yml', ...args]);
}
function imageId(ref) {
  const id = docker(['image', 'inspect', '--format', '{{.Id}}', ref]);
  assert.match(id, /^sha256:[a-f0-9]{64}$/);
  return id;
}
function projectResources(project, kind) {
  return docker([
    kind,
    'ls',
    '-q',
    ...(kind === 'container' ? ['--all'] : []),
    '--filter',
    `label=com.docker.compose.project=${project}`,
  ])
    .split(/\s+/)
    .filter(Boolean);
}
function sql(project, query) {
  return composeExec(project, 'db', ['psql', '-U', 'pixb', '-d', 'pixb', '-Atc', query]);
}
function composeExec(project, service, args) {
  return compose(project, ['exec', '-T', service, ...args]);
}
function containerState(project, service) {
  const id = compose(project, ['ps', '-aq', service]);
  assert.match(id, /^[a-f0-9]{12,64}$/);
  const [container, image, mounts] = docker([
    'container',
    'inspect',
    '--format',
    '{{.Id}}\n{{.Image}}\n{{json .Mounts}}',
    id,
  ]).split(/\r?\n/);
  const volumes = Object.fromEntries(
    JSON.parse(mounts)
      .filter((mount) => mount.Type === 'volume')
      .map((mount) => [mount.Destination, mount.Name]),
  );
  return { container, image, volumes };
}
function migrationHistory(project) {
  return JSON.parse(
    sql(
      project,
      `SELECT COALESCE(json_agg(m ORDER BY m.migration_name), '[]')
       FROM _prisma_migrations m WHERE m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL;`,
    ),
  );
}
function migrationFiles(project) {
  return JSON.parse(
    composeExec(project, 'app', [
      'node',
      '-e',
      "console.log(JSON.stringify([...require('./docker/db-check.js').loadMigrations()].sort()))",
    ]),
  );
}
function credentialState(project) {
  return {
    keys: composeExec(project, 'app', [
      'node',
      '-e',
      `const { createHash } = require('node:crypto');
      const { readFileSync } = require('node:fs');
      for (const file of ['/app/config/secrets.json', '/run/pixb-database/postgres-password']) {
        console.log(createHash('sha256').update(readFileSync(file)).digest('hex'));
      }`,
    ]),
    fingerprint: sql(
      project,
      "SELECT value FROM settings WHERE key='instance.secrets_fingerprint';",
    ),
    // Fixture requests can touch updated_at without replacing the session or its token.
    sessions: hash(sql(project, "SELECT to_jsonb(s) - 'updated_at' FROM sessions s ORDER BY id;")),
  };
}
async function origin(project) {
  const port = compose(project, ['port', 'app', '3000']);
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://${port}/api/health`)).ok) return `http://${port}`;
    } catch {
      /* starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Drill app did not become healthy');
}
let cookie;
const headers = (extra = {}) => ({
  Connection: 'close',
  ...(cookie ? { Cookie: cookie } : {}),
  ...extra,
});
async function json(url, endpoint, body, method = 'POST') {
  return fetch(`${url}${endpoint}`, {
    method,
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
}
async function uploaded(url, bytes, name, type) {
  const data = new FormData();
  data.set('file', new File([bytes], name, { type }));
  const response = await fetch(`${url}/api/v1/uploads`, {
    method: 'POST',
    headers: headers(),
    body: data,
  });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).file;
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function bytesAt(url, pathname) {
  const response = await fetch(`${url}${pathname}`, { headers: headers() });
  assert.equal(response.status, 200);
  return Buffer.from(await response.arrayBuffer());
}
function cleanup() {
  for (const project of projects) {
    if (!/^pixb-(backup-test|restore)-[a-f0-9]{12}$/.test(project))
      throw new Error('Unsafe drill cleanup project');
    compose(project, ['--profile', 'bootstrap', 'down', '--volumes', '--remove-orphans']);
    // A deliberately failed restore may have volumes that Compose never mounted.
    for (const name of projectResources(project, 'volume')) {
      if (!name.startsWith(project + '_')) throw new Error('Unsafe drill volume');
      docker(['volume', 'rm', name]);
    }
    for (const kind of ['container', 'network', 'volume']) {
      assert.deepEqual(projectResources(project, kind), [], `Leftover ${kind} in ${project}`);
    }
  }
  console.log = log;
  if (!work.startsWith(root + path.sep) || !path.basename(work).startsWith('backup-drill-'))
    throw new Error('Unsafe drill directory');
  rmSync(work, { recursive: true, force: true });
}
try {
  for (const kind of ['container', 'network', 'volume']) {
    assert.deepEqual(projectResources(source, kind), [], 'Drill project already exists');
  }
  projects.add(source);
  let nextImage;
  if (upgrade) {
    env.PIXB_IMAGE = imageId(image);
    nextImage = imageId(args[2]);
    env.PIXB_DATABASE_IMAGE = imageId(env.PIXB_DATABASE_IMAGE);
    assert.notEqual(nextImage, env.PIXB_IMAGE, 'Old and new app images must have distinct IDs');
  }
  const noPull = upgrade ? ['--pull', 'never'] : [];
  compose(source, ['run', '--rm', '--no-deps', ...noPull, 'init-config']);
  compose(source, ['up', '-d', '--no-build', ...noPull, '--wait', 'app']);
  let url = await origin(source);
  const setup = await json(url, '/api/v1/setup', {
    admin: {
      username: 'backuptester',
      email: 'backup@example.invalid',
      password: 'Backup-Test-Password-2026!',
      password_confirmation: 'Backup-Test-Password-2026!',
    },
  });
  assert.equal(setup.status, 201, await setup.clone().text());
  cookie = setup.headers.get('set-cookie').split(';')[0];
  const data = Buffer.from('A private library survives a complete restore.\n'.repeat(1000));
  const file = await uploaded(url, data, 'cozy notes.txt', 'text/plain');
  const originalPath = new URL(file.links.original).pathname;
  const png = Buffer.from(
    composeExec(source, 'app', [
      'node',
      '-e',
      "require('sharp')({create:{width:32,height:32,channels:3,background:'#d7ac67'}}).png().toBuffer().then(x=>console.log(x.toString('base64')))",
    ]),
    'base64',
  );
  const picture = await uploaded(url, png, 'warm.png', 'image/png');
  const thumbPath = new URL(picture.links.thumbnail).pathname;
  // Wait for the real generated preview before taking the coordinated backup.
  let thumb;
  for (let i = 0; i < 40; i++) {
    const response = await fetch(`${url}${thumbPath}`, { headers: headers() });
    if (response.ok) {
      thumb = Buffer.from(await response.arrayBuffer());
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(thumb?.length);
  const avatar = await json(url, '/api/v1/user/update_profile_picture', {
    user: { avatar: `data:image/png;base64,${png.toString('base64')}` },
  });
  assert.equal(avatar.status, 200, await avatar.clone().text());
  const avatarPath = new URL((await avatar.json()).attributes.avatar.medium).pathname;
  const avatarBytes = await bytesAt(url, avatarPath);
  const collectionResponse = await json(url, '/api/v1/collections', { name: 'Cozy memories' });
  assert.equal(collectionResponse.status, 201);
  const collection = (await collectionResponse.json()).collection;
  assert.equal(
    (
      await json(url, `/api/v1/collections/${collection.id}/members`, {
        ids: [file.id, picture.id],
      })
    ).status,
    200,
  );
  assert.equal(
    (await json(url, `/api/v1/medias/${file.id}`, { favorite: true }, 'PATCH')).status,
    200,
  );
  const shared = await json(url, `/api/v1/medias/${picture.id}/share`, {});
  assert.equal(shared.status, 200);
  const sharePath = new URL((await shared.json()).shareUrl).pathname;
  const keyResponse = await json(url, '/api/v1/api_keys', {
    api_key: { name: 'backup-read', expiration: 4, scopes: ['read'] },
  });
  assert.equal(keyResponse.status, 201);
  const key = (await keyResponse.json()).encoded_token;
  const totp = await json(url, '/api/v1/user/totp/enable', {});
  assert.equal(totp.status, 200);
  const { secret } = await totp.json(); // Remains unverified until after restore, proving decryption there.
  const encrypted = sql(source, 'SELECT secret FROM totp_secrets;');
  assert.notEqual(encrypted, secret);
  assert.equal(
    (await json(url, '/api/v1/instance', { settings: { maxUploadSize: 19 } }, 'PATCH')).status,
    200,
  );
  const tusHeaders = headers({ 'Tus-Resumable': '1.0.0' });
  const pending = await fetch(`${url}/files`, {
    method: 'POST',
    headers: {
      ...tusHeaders,
      'Upload-Length': String(data.length),
      'Upload-Metadata': `filename ${Buffer.from('resumed.txt').toString('base64')},filetype ${Buffer.from('text/plain').toString('base64')}`,
    },
  });
  assert.equal(pending.status, 201);
  const tusPath = new URL(pending.headers.get('location')).pathname;
  const prefix = 1234;
  const patch = (base, offset, bytes) =>
    fetch(`${base}${tusPath}`, {
      method: 'PATCH',
      headers: {
        ...tusHeaders,
        'Content-Type': 'application/offset+octet-stream',
        'Upload-Offset': String(offset),
      },
      body: bytes,
    });
  assert.equal((await patch(url, 0, data.subarray(0, prefix))).status, 204);
  const physical = sql(source, `SELECT file_data FROM medias WHERE id=${file.id};`);
  const migrations = sql(
    source,
    'SELECT migration_name FROM _prisma_migrations ORDER BY migration_name;',
  );
  await main(['backup', source, backup]);
  assert.equal((await verify(backup)).originals, 2);
  url = await origin(source);
  assert.equal(hash(await bytesAt(url, originalPath)), hash(data));
  await assert.rejects(main(['backup', source, backup]), /EEXIST/);
  console.log(
    'PASS coordinated backup completes, preserves the source, and never overwrites an existing set',
  );

  if (upgrade) {
    // Follow docs/self-hosting.md: swap only PIXB_IMAGE, then recreate just the app.
    const appBefore = containerState(source, 'app');
    const dbBefore = containerState(source, 'db');
    const historyBefore = migrationHistory(source);
    const credentialsBefore = credentialState(source);
    assert.equal(appBefore.image, env.PIXB_IMAGE);
    env.PIXB_IMAGE = nextImage;
    compose(source, ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', 'app']);
    const appAfter = containerState(source, 'app');
    assert.equal(appAfter.image, nextImage, 'The app runs the new image');
    assert.notEqual(appAfter.container, appBefore.container, 'The app container was recreated');
    assert.deepEqual(appAfter.volumes, appBefore.volumes, 'The app keeps the same volumes');
    assert.deepEqual(containerState(source, 'db'), dbBefore, 'The database is left untouched');
    // Every migration applied before the upgrade survives unchanged, and the database now
    // holds exactly the migrations the new image ships.
    const historyAfter = migrationHistory(source);
    for (const applied of historyBefore) {
      assert.deepEqual(
        historyAfter.find((row) => row.id === applied.id),
        applied,
        `Migration ${applied.migration_name} is unchanged`,
      );
    }
    assert.deepEqual(
      historyAfter.map((row) => [row.migration_name, row.checksum]),
      migrationFiles(source),
      'The database matches the new image migrations',
    );
    assert.deepEqual(credentialState(source), credentialsBefore, 'Keys and sessions are kept');
    url = await origin(source);
    assert.equal((await fetch(`${url}/api/v1/user`, { headers: headers() })).status, 200);
    assert.equal(hash(await bytesAt(url, originalPath)), hash(data));
    assert.equal(hash(await bytesAt(url, thumbPath)), hash(thumb));
    assert.equal(hash(await bytesAt(url, avatarPath)), hash(avatarBytes));
    assert.equal((await fetch(`${url}${sharePath}`)).status, 200);
    assert.equal(
      (await fetch(`${url}/api/v1/medias`, { headers: { Authorization: `Bearer ${key}` } })).status,
      200,
    );
    const upgradedHead = await fetch(`${url}${tusPath}`, { method: 'HEAD', headers: tusHeaders });
    assert.equal(Number(upgradedHead.headers.get('upload-offset')), prefix);
    // A new upload works, then goes away so the rest of the drill sees the original library.
    const fresh = await uploaded(url, Buffer.from('After upgrade'), 'upgraded.txt', 'text/plain');
    assert.equal(
      (await fetch(`${url}/api/v1/medias/${fresh.id}`, { method: 'DELETE', headers: headers() }))
        .status,
      200,
    );
    console.log(
      'PASS app upgrade keeps the database, volumes, keys, sessions, files, previews, links, API keys, and TUS progress',
    );
  }

  const restored = await main([
    'restore',
    backup,
    'http://localhost',
    path.join(work, 'deployment'),
  ]);
  const target = restored.project;
  const targetUrl = restored.address;
  // The saved deployment works without source .env values or a drifting DB tag.
  docker([
    'compose',
    '-f',
    restored.deploymentFile,
    'up',
    '-d',
    '--no-build',
    '--force-recreate',
    '--wait',
  ]);
  assert.equal(await origin(target), targetUrl);
  assert.equal(
    sql(target, 'SELECT migration_name FROM _prisma_migrations ORDER BY migration_name;'),
    migrations,
  );
  assert.equal((await fetch(`${targetUrl}/api/v1/user`, { headers: headers() })).status, 200);
  assert.equal(hash(await bytesAt(targetUrl, originalPath)), hash(data));
  assert.equal(hash(await bytesAt(targetUrl, new URL(picture.links.original).pathname)), hash(png));
  assert.equal(hash(await bytesAt(targetUrl, avatarPath)), hash(avatarBytes));
  assert.equal(hash(await bytesAt(targetUrl, thumbPath)), hash(thumb));
  const favorites = await (
    await fetch(`${targetUrl}/api/v1/medias?favorite=true`, { headers: headers() })
  ).json();
  assert.equal(favorites.files[0].id, file.id);
  const members = await (
    await fetch(`${targetUrl}/api/v1/medias?collection=${collection.id}`, { headers: headers() })
  ).json();
  assert.equal(members.total, 2);
  assert.equal((await fetch(`${targetUrl}${sharePath}`)).status, 200);
  assert.equal(
    (await fetch(`${targetUrl}/api/v1/medias`, { headers: { Authorization: `Bearer ${key}` } }))
      .status,
    200,
  );
  const instance = await (
    await fetch(`${targetUrl}/api/v1/instance`, { headers: headers() })
  ).json();
  assert.equal(instance.settings.maxUploadSize, 19);
  assert.equal(sql(target, 'SELECT secret FROM totp_secrets;'), encrypted);
  const token = new TOTP({
    secret: Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }).generate();
  assert.equal((await json(targetUrl, '/api/v1/user/totp/verify', { token })).status, 200);
  const login = await json(targetUrl, '/api/v1/sessions', {
    user: { login: 'backuptester', password: 'Backup-Test-Password-2026!' },
  });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).requires_totp, true);
  const head = await fetch(`${targetUrl}${tusPath}`, { method: 'HEAD', headers: tusHeaders });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('upload-offset')), prefix);
  assert.equal((await patch(targetUrl, prefix, data.subarray(prefix))).status, 204);
  const resumedUid = sql(target, 'SELECT uid FROM medias WHERE upload_id IS NOT NULL;');
  assert.equal(hash(await bytesAt(targetUrl, `/raw/${resumedUid}`)), hash(data));
  const added = await uploaded(targetUrl, Buffer.from('After restore'), 'new.txt', 'text/plain');
  assert.ok(BigInt(added.id) > BigInt(picture.id));
  assert.equal(sql(source, 'SELECT count(*) FROM medias;'), '2');
  console.log(
    'PASS fresh restore preserves original bytes, previews, avatars, collections, favorites, sharing, settings, sessions/API keys, encrypted TOTP, TUS progress, and database sequences',
  );

  const damaged = path.join(work, 'damaged');
  cpSync(backup, damaged, { recursive: true });
  writeFileSync(path.join(damaged, 'database.dump'), 'truncated');
  await assert.rejects(
    main(['restore', damaged, 'http://localhost', path.join(work, 'rejected')]),
    /verification failed/,
  );
  // Even an archive with a matching checksum but an invalid dump must fail in
  // a separate database before the app starts, leaving the source untouched.
  const badManifest = JSON.parse(readFileSync(path.join(damaged, 'manifest.json'), 'utf8'));
  badManifest.artifacts['database.dump'] = { size: 9, sha256: hash(Buffer.from('truncated')) };
  writeFileSync(path.join(damaged, 'manifest.json'), JSON.stringify(badManifest));
  await assert.rejects(
    main(['restore', damaged, 'http://localhost', path.join(work, 'failed-import')]),
    /Restore failed/,
  );
  const failed = [...projects].at(-1);
  assert.equal(
    sql(failed, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"),
    '0',
  );
  assert.equal(compose(failed, ['ps', '-aq', 'app']), '');
  compose(source, ['stop', 'app']);
  await main(['backup', source, path.join(work, 'stopped-source')]);
  assert.equal(
    docker(['inspect', '--format', '{{.State.Running}}', compose(source, ['ps', '-aq', 'app'])]),
    'false',
  );
  compose(source, ['up', '-d', '--no-build', '--wait', 'app']);
  url = await origin(source);
  composeExec(source, 'app', [
    'node',
    '-e',
    "require('node:fs').symlinkSync('/etc/passwd','/app/storage/unsafe-fixture')",
  ]);
  try {
    await assert.rejects(
      main(['backup', source, path.join(work, 'symlink-source')]),
      /regular files/,
    );
  } finally {
    composeExec(source, 'app', [
      'node',
      '-e',
      "require('node:fs').unlinkSync('/app/storage/unsafe-fixture')",
    ]);
  }
  await assert.rejects(verify(path.join(work, 'symlink-source')), /incomplete/);
  // A missing original must leave an incomplete set and restart the source.
  const rename = (from, to) =>
    composeExec(source, 'app', [
      'node',
      '-e',
      `require('node:fs').renameSync(${JSON.stringify(from)},${JSON.stringify(to)})`,
    ]);
  rename(physical, physical + '.fixture-missing');
  try {
    await assert.rejects(main(['backup', source, path.join(work, 'incomplete')]));
  } finally {
    rename(physical + '.fixture-missing', physical);
  }
  await assert.rejects(verify(path.join(work, 'incomplete')), /incomplete/);
  url = await origin(source);
  assert.equal(hash(await bytesAt(url, originalPath)), hash(data));
  console.log(
    'PASS corrupt backups, invalid imports, and source symlinks refuse safely; incomplete sets are rejected and source running/stopped state is preserved',
  );
} finally {
  cleanup();
}
