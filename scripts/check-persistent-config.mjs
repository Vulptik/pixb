import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { TOTP, Secret } from 'otpauth';

const project = `pixb-config-test-${randomBytes(6).toString('hex')}`;
const image = process.argv[2] || process.env.PIXB_IMAGE || 'pixb:local';
const env = {
  ...process.env,
  PUBLIC_URL: 'http://localhost',
  PIXB_IMAGE: image,
  PIXB_DATABASE_IMAGE: process.env.PIXB_DATABASE_IMAGE || 'pixb-postgres:local',
  PIXB_PORT: '0',
  PIXB_BIND_ADDRESS: '127.0.0.1',
};
const base = ['compose', '-p', project, '-f', 'compose.production.yml'];
function docker(args, { input, failure = false } = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', input, env, timeout: 120000 });
  if (result.error) throw result.error;
  if (failure) {
    assert.notEqual(result.status, 0, 'Unsafe startup must fail');
    return result.stdout + result.stderr;
  }
  if (result.status !== 0)
    throw new Error(result.stderr || result.stdout || 'Docker command failed');
  return result.stdout.trim();
}
function compose(args, options) {
  return docker([...base, ...args], options);
}
function inspectConfig(code) {
  return compose(['run', '--rm', '--no-deps', '--entrypoint', 'node', 'init-config', '-e', code]);
}
const file = '/app/config/secrets.json';
const backup = '/app/config/secrets.fixture-backup';
function digest() {
  return inspectConfig(
    `const fs=require('node:fs'),c=require('node:crypto');console.log(c.createHash('sha256').update(fs.readFileSync('${file}')).digest('hex'))`,
  );
}
function restore() {
  inspectConfig(
    `const fs=require('node:fs');fs.copyFileSync('${backup}','${file}');fs.chmodSync('${file}',0o600)`,
  );
}
function sql(query) {
  return compose(
    ['exec', '-T', 'db', 'psql', '-U', 'pixb', '-d', 'pixb', '-v', 'ON_ERROR_STOP=1', '-At'],
    { input: query },
  );
}
async function healthy() {
  const port = compose(['port', 'app', '3000']).split(':').at(-1);
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return origin;
    } catch {
      /* starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Persistent-config app did not become healthy.');
}
function rejected(pattern) {
  const output = compose(['run', '--rm', '--no-deps', 'app'], { failure: true });
  assert.match(output, pattern);
}
async function post(origin, endpoint, body, cookie) {
  return fetch(`${origin}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function cleanup() {
  if (!/^pixb-config-test-[0-9a-f]{12}$/.test(project)) throw new Error('Unsafe cleanup project');
  compose(['--profile', 'bootstrap', 'down', '--volumes', '--remove-orphans']);
}

try {
  // Each volume and network belongs to this random project. No legacy/local
  // development resources or host directories are mounted or modified.
  compose(['run', '--rm', '--no-deps', 'init-config']);
  const originalDigest = digest();
  const passwordDigest = inspectConfig(
    "const fs=require('node:fs'),c=require('node:crypto');console.log(c.createHash('sha256').update(fs.readFileSync('/app/database-secret/postgres-password')).digest('hex'))",
  );
  compose(['run', '--rm', '--no-deps', 'init-config']);
  assert.equal(digest(), originalDigest);
  assert.equal(
    inspectConfig(
      "const fs=require('node:fs'),c=require('node:crypto');console.log(c.createHash('sha256').update(fs.readFileSync('/app/database-secret/postgres-password')).digest('hex'))",
    ),
    passwordDigest,
  );
  compose(['up', '-d', '--no-build', '--wait', 'app']);
  let origin = await healthy();
  assert.equal(sql('SELECT COUNT(*) FROM users;'), '0');
  const setup = await post(origin, '/api/v1/setup', {
    admin: {
      username: 'configtester',
      email: 'config@example.invalid',
      password: 'Persistent-Test-Password-2026!',
      password_confirmation: 'Persistent-Test-Password-2026!',
    },
  });
  assert.equal(setup.status, 201, await setup.text());
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  const totpSetup = await post(origin, '/api/v1/user/totp/enable', {}, cookie);
  assert.equal(totpSetup.status, 200);
  const { secret } = await totpSetup.json();
  const encrypted = sql('SELECT secret FROM totp_secrets;');
  assert.notEqual(encrypted, secret);
  assert.equal(sql("SELECT COUNT(*) FROM settings WHERE key='instance.secrets_fingerprint';"), '1');
  console.log(
    'PASS explicit fresh initialization is repeatable; secrets are separate; app uses read-only config and file-based DB password',
  );

  compose(['up', '-d', '--no-build', '--force-recreate', '--wait', 'db']);
  compose(['up', '-d', '--no-build', '--force-recreate', '--no-deps', '--wait', 'app']);
  origin = await healthy();
  assert.equal(digest(), originalDigest);
  assert.equal((await fetch(`${origin}/api/v1/user`, { headers: { Cookie: cookie } })).status, 200);
  const token = new TOTP({
    secret: Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }).generate();
  assert.equal((await post(origin, '/api/v1/user/totp/verify', { token }, cookie)).status, 200);
  assert.equal(sql('SELECT secret FROM totp_secrets;'), encrypted);
  console.log(
    'PASS database/app recreation preserves keys, existing signed session, and decryptable TOTP configuration',
  );

  const conflict = compose(
    ['run', '--rm', '--no-deps', '-e', `JWT_SECRET=${'conflicting-key-'.repeat(4)}`, 'app'],
    { failure: true },
  );
  assert.match(conflict, /conflict with persistent secrets/);
  assert.equal(digest(), originalDigest);
  console.log('PASS conflicting environment key is refused without rotating persisted secrets');

  compose(['stop', 'app']);
  inspectConfig(`require('node:fs').copyFileSync('${file}','${backup}')`);
  inspectConfig(`require('node:fs').writeFileSync('${file}','{broken')`);
  const corruptDigest = digest();
  rejected(/invalid or unreadable/);
  assert.equal(digest(), corruptDigest);
  restore();

  inspectConfig(`require('node:fs').unlinkSync('${file}')`);
  rejected(/Persistent secrets are missing/);
  assert.equal(inspectConfig(`console.log(require('node:fs').existsSync('${file}'))`), 'false');
  assert.match(
    compose(['run', '--rm', '--no-deps', 'init-config'], { failure: true }),
    /Incomplete installation secrets/,
  );
  restore();
  console.log(
    'PASS corrupt/missing config and incomplete bootstrap refuse to invent replacement keys',
  );

  inspectConfig(
    `require('node:fs').writeFileSync('${file}',JSON.stringify(require('./docker/config').freshSecrets()))`,
  );
  const wrongDigest = digest();
  rejected(/do not match this database/);
  assert.equal(digest(), wrongDigest);
  restore();
  inspectConfig(`require('node:fs').chmodSync('${file}',0o644)`);
  rejected(/private regular file/);
  restore();
  inspectConfig(
    `const fs=require('node:fs');fs.unlinkSync('${file}');fs.symlinkSync('/etc/passwd','${file}')`,
  );
  rejected(/private regular file/);
  inspectConfig(`require('node:fs').unlinkSync('${file}')`);
  restore();
  console.log(
    'PASS wrong-installation config, unsafe permissions, and symlinked secrets are refused',
  );
  inspectConfig("require('node:fs').symlinkSync('.', '/app/config/linked-config')");
  const linkedDirectory = compose(
    ['run', '--rm', '--no-deps', '-e', 'PIXB_CONFIG_PATH=/app/config/linked-config', 'app'],
    { failure: true },
  );
  assert.match(linkedDirectory, /Cannot read persistent config/);
  inspectConfig("require('node:fs').unlinkSync('/app/config/linked-config')");

  const readOnly = docker(
    ['run', '--rm', '--read-only', '--entrypoint', 'node', image, 'docker/config.js', 'initialize'],
    { failure: true },
  );
  assert.match(readOnly, /Secret storage is unavailable/);
  compose(['up', '-d', '--no-build', '--wait', 'app']);
  origin = await healthy();
  assert.equal(digest(), originalDigest);
  assert.equal((await fetch(`${origin}/api/v1/user`, { headers: { Cookie: cookie } })).status, 200);
  assert.equal(sql('SELECT COUNT(*) FROM users;'), '1');
  console.log(
    'PASS unwritable fresh storage fails; restoring the original config recovers access without data changes',
  );
} finally {
  cleanup();
}
