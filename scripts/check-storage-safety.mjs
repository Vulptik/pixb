import { spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const project = `pixb-storage-test-${randomBytes(6).toString('hex')}`;
const image = process.argv[2] || process.env.PIXB_IMAGE || 'pixb:local';
const env = {
  ...process.env,
  PUBLIC_URL: 'http://localhost',
  PIXB_IMAGE: image,
  PIXB_DATABASE_IMAGE: process.env.PIXB_DATABASE_IMAGE || 'pixb-postgres:local',
  PIXB_PORT: '0',
  PIXB_BIND_ADDRESS: '127.0.0.1',
};
const root = path.resolve('.local-rebuild');
mkdirSync(root, { recursive: true });
const override = path.join(root, `${project}.json`);
function compose(args, { failure = false, modified = false, input } = {}) {
  const files = ['-f', 'compose.production.yml', ...(modified ? ['-f', override] : [])];
  const result = spawnSync('docker', ['compose', '-p', project, ...files, ...args], {
    encoding: 'utf8',
    input,
    env,
    timeout: 120000,
  });
  if (result.error) throw result.error;
  if (failure) {
    assert.notEqual(result.status, 0);
    return result.stdout + result.stderr;
  }
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  return result.stdout.trim();
}
function sql(text) {
  return compose(
    ['exec', '-T', 'db', 'psql', '-U', 'pixb', '-d', 'pixb', '-v', 'ON_ERROR_STOP=1', '-At'],
    { input: text },
  );
}
function exec(code) {
  return compose(['exec', '-T', 'app', 'node', '-e', code]);
}
function setOverride(app) {
  writeFileSync(override, JSON.stringify({ services: { app } }));
}
function assertBoundedStorage() {
  assert.equal(
    exec("const s=require('node:fs').statfsSync('/app/storage');console.log(s.bsize*s.blocks)"),
    String(16 * 1024 ** 2),
    'Storage fault tests require a bounded 16 MiB tmpfs',
  );
}
async function healthy() {
  const port = compose(['port', 'app', '3000']).split(':').at(-1);
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return origin;
    } catch {
      /* starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Storage test app never became ready');
}
let cookie;
function headers(extra = {}) {
  // Failed streams can close their HTTP/1 connection after the response.
  // Keep the fault scenarios independent of undici reusing that closing socket.
  return { Cookie: cookie, Connection: 'close', ...extra };
}
async function upload(origin, text = 'keep this existing file') {
  const form = new FormData();
  form.set('file', new File([text], 'fixture.txt', { type: 'text/plain' }));
  return fetch(`${origin}/api/v1/uploads`, { method: 'POST', headers: headers(), body: form });
}
function cleanup() {
  if (!/^pixb-storage-test-[a-f0-9]{12}$/.test(project) || !override.startsWith(root + path.sep))
    throw new Error('Unsafe cleanup target');
  compose(['--profile', 'bootstrap', 'down', '--volumes', '--remove-orphans']);
  try {
    unlinkSync(override);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

try {
  compose(['run', '--rm', '--no-deps', 'init-config']);
  compose(['up', '-d', '--no-build', '--wait', 'app']);
  let origin = await healthy();
  const setup = await fetch(`${origin}/api/v1/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      admin: {
        username: 'storagetester',
        email: 'storage@example.invalid',
        password: 'Storage-Test-Password-2026!',
        password_confirmation: 'Storage-Test-Password-2026!',
      },
    }),
  });
  assert.equal(setup.status, 201, await setup.text());
  cookie = setup.headers.get('set-cookie').split(';')[0];
  const tusHeaders = headers({ 'Tus-Resumable': '1.0.0' });
  const initial = await upload(origin);
  assert.equal(initial.status, 201, await initial.clone().text());
  const existing = (await initial.json()).file;
  const originalPath = new URL(existing.links.original).pathname;
  const physical = sql('SELECT file_data FROM medias LIMIT 1;');
  assert.ok(physical.startsWith('/app/storage/uploads/'), 'Fixture path stays in test storage');
  const verifyOriginal = async () => {
    const response = await fetch(`${origin}${originalPath}`, { headers: headers() });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'keep this existing file');
  };
  await verifyOriginal();
  const large = await upload(origin, 'a'.repeat(12 * 1024 ** 2));
  assert.equal(large.status, 201, await large.clone().text());
  const largeFile = (await large.json()).file;
  const largeDownload = await fetch(`${origin}${new URL(largeFile.links.original).pathname}`, {
    headers: headers(),
  });
  assert.equal(largeDownload.status, 200);
  assert.equal((await largeDownload.arrayBuffer()).byteLength, 12 * 1024 ** 2);
  assert.equal(
    (
      await fetch(`${origin}/api/v1/medias/${largeFile.id}`, {
        method: 'DELETE',
        headers: headers(),
      })
    ).status,
    200,
  );
  assert.equal(sql('SELECT COUNT(*) FROM medias;'), '1');
  console.log(
    'PASS multipart uploads above the page proxy body limit save and download completely',
  );
  exec("const fs=require('node:fs');fs.chmodSync('/app/storage/tus-uploads',0o500)");
  const denied = await upload(origin, 'permission failure');
  assert.equal(denied.status, 503);
  assert.equal((await denied.json()).code, 'storageUnavailable');
  const deniedTus = await fetch(`${origin}/files`, {
    method: 'POST',
    headers: { ...tusHeaders, 'Upload-Length': '20' },
  });
  assert.equal(deniedTus.status, 503, await deniedTus.clone().text());
  assert.match(await deniedTus.text(), /storageUnavailable/);
  exec("require('node:fs').chmodSync('/app/storage/tus-uploads',0o700)");
  await verifyOriginal();
  compose(['stop', 'app']);
  setOverride({
    volumes: [{ type: 'volume', source: 'files', target: '/app/storage', read_only: true }],
  });
  assert.match(
    compose(['run', '--rm', '--no-deps', 'app'], { failure: true, modified: true }),
    /File storage is unavailable/,
  );
  console.log(
    'PASS live permission errors return 503; read-only storage refuses startup; existing library file stays intact',
  );

  const seed = `const fs=require('node:fs'),p=require('node:path');fs.mkdirSync(p.dirname(${JSON.stringify(physical)}),{recursive:true});fs.writeFileSync(${JSON.stringify(physical)},'keep this existing file');`;
  const tmpfs = [
    { type: 'tmpfs', target: '/app/storage', tmpfs: { size: 16 * 1024 ** 2, mode: 511 } },
  ];
  setOverride({ volumes: tmpfs, command: ['node', '-e', seed + "require('./server.js')"] });
  // Compose can inherit the previous container's mount during recreation.
  // Remove only this disposable app container before changing mount types.
  compose(['rm', '-s', '-f', 'app']);
  compose(['up', '-d', '--no-build', '--force-recreate', '--no-deps', '--wait', 'app'], {
    modified: true,
  });
  origin = await healthy();
  assertBoundedStorage();
  const full = await upload(origin, 'low space');
  assert.equal(full.status, 507);
  assert.equal((await full.json()).code, 'storageFull');
  const tusLow = await fetch(`${origin}/files`, {
    method: 'POST',
    headers: { ...tusHeaders, 'Upload-Length': '20' },
  });
  assert.equal(tusLow.status, 507);
  assert.equal(sql('SELECT COUNT(*) FROM medias;'), '1');
  await verifyOriginal();
  console.log(
    'PASS real 16 MiB tmpfs low-space admission returns 507 for multipart and TUS; existing downloads remain usable',
  );

  // Fault injection is confined to this test-only launcher. Report artificial
  // free space, then exercise real ENOSPC inside a 16 MiB tmpfs. Product code
  // has no switch to disable storage checks, and no real host disk is filled.
  const inject =
    "const fp=require('node:fs/promises'),real=fp.statfs;fp.statfs=async(...args)=>{const info=await real(...args);info.bavail=info.blocks+(1024n**3n);return info;};";
  setOverride({
    volumes: tmpfs,
    command: ['node', '-e', seed + inject + "require('./server.js')"],
  });
  compose(['rm', '-s', '-f', 'app']);
  compose(['up', '-d', '--no-build', '--force-recreate', '--no-deps', '--wait', 'app'], {
    modified: true,
  });
  origin = await healthy();
  assertBoundedStorage();
  exec("require('node:fs').writeFileSync('/app/storage/filler',Buffer.alloc(10*1024*1024))");
  const huge = await upload(origin, 'a'.repeat(8 * 1024 ** 2));
  assert.equal(huge.status, 507, await huge.clone().text());
  assert.equal((await huge.json()).code, 'storageFull');
  exec("require('node:fs').unlinkSync('/app/storage/filler')");
  assert.equal(
    exec(
      "console.log(require('node:fs').readdirSync('/app/storage/tus-uploads').filter(x=>x.startsWith('multipart-')).length)",
    ),
    '0',
  );
  assert.equal(sql('SELECT COUNT(*) FROM medias;'), '1');
  await verifyOriginal();
  console.log(
    'PASS real ENOSPC during multipart streaming cleans partial bytes, preserves the existing file, and leaves the process healthy',
  );

  const data = Buffer.alloc(4 * 1024 ** 2, 97);
  async function beginTus() {
    const response = await fetch(`${origin}/files`, {
      method: 'POST',
      headers: {
        ...tusHeaders,
        'Upload-Length': String(data.length),
        'Upload-Metadata': `filename ${Buffer.from('resume.txt').toString('base64')},filetype ${Buffer.from('text/plain').toString('base64')}`,
      },
    });
    assert.equal(response.status, 201, await response.clone().text());
    return new URL(response.headers.get('location'), origin).pathname;
  }
  const patch = (url, offset) =>
    fetch(`${origin}${url}`, {
      method: 'PATCH',
      headers: {
        ...tusHeaders,
        'Content-Type': 'application/offset+octet-stream',
        'Upload-Offset': String(offset),
      },
      body: data.subarray(offset),
    });
  exec("require('node:fs').writeFileSync('/app/storage/filler',Buffer.alloc(14*1024*1024))");
  const partialUrl = await beginTus();
  assert.equal((await patch(partialUrl, 0)).status, 507);
  const partial = await fetch(`${origin}${partialUrl}`, { method: 'HEAD', headers: tusHeaders });
  assert.equal(partial.status, 200);
  const offset = Number(partial.headers.get('upload-offset'));
  assert.ok(offset > 0 && offset < data.length);
  exec("require('node:fs').unlinkSync('/app/storage/filler')");
  assert.equal((await patch(partialUrl, offset)).status, 204);
  assert.equal(sql('SELECT COUNT(*) FROM medias;'), '2');
  const partialId = sql('SELECT id FROM medias WHERE upload_id IS NOT NULL LIMIT 1;');
  const partialUid = sql('SELECT uid FROM medias WHERE upload_id IS NOT NULL LIMIT 1;');
  const resumed = await fetch(`${origin}/raw/${partialUid}`, { headers: headers() });
  assert.equal(resumed.status, 200);
  assert.equal(
    createHash('sha256')
      .update(Buffer.from(await resumed.arrayBuffer()))
      .digest('hex'),
    createHash('sha256').update(data).digest('hex'),
  );
  assert.equal(
    (await fetch(`${origin}/api/v1/medias/${partialId}`, { method: 'DELETE', headers: headers() }))
      .status,
    200,
  );
  assert.equal(
    (await fetch(`${origin}${partialUrl}`, { method: 'DELETE', headers: tusHeaders })).status,
    204,
  );
  console.log(
    'PASS real ENOSPC mid-TUS preserves the received prefix and resumes after bounded filler removal',
  );

  exec("require('node:fs').writeFileSync('/app/storage/filler',Buffer.alloc(10*1024*1024))");
  const finalUrl = await beginTus();
  assert.equal((await patch(finalUrl, 0)).status, 507);
  assert.equal(sql('SELECT COUNT(*) FROM medias;'), '1');
  assert.equal(
    (await fetch(`${origin}${finalUrl}`, { method: 'HEAD', headers: tusHeaders })).status,
    507,
  );
  assert.equal(
    exec(
      "console.log(require('node:fs').readdirSync('/app/storage/tus-uploads').filter(x=>x.startsWith('finalize-')).length)",
    ),
    '0',
  );
  exec("require('node:fs').unlinkSync('/app/storage/filler')");
  const retry = await fetch(`${origin}${finalUrl}`, { method: 'HEAD', headers: tusHeaders });
  assert.equal(retry.status, 200);
  assert.equal(Number(retry.headers.get('upload-offset')), data.length);
  assert.equal(sql('SELECT COUNT(*) FROM medias;'), '2');
  const uid = sql('SELECT uid FROM medias WHERE upload_id IS NOT NULL LIMIT 1;');
  const downloaded = await (
    await fetch(`${origin}/raw/${uid}`, { headers: headers() })
  ).arrayBuffer();
  assert.equal(
    createHash('sha256').update(Buffer.from(downloaded)).digest('hex'),
    createHash('sha256').update(data).digest('hex'),
  );
  assert.equal(
    (await fetch(`${origin}${finalUrl}`, { method: 'HEAD', headers: tusHeaders })).status,
    200,
  );
  assert.equal(sql('SELECT COUNT(*) FROM medias;'), '2');
  await verifyOriginal();
  console.log(
    'PASS failed final copy cannot report completion; HEAD retries finalization after space recovery exactly once with intact bytes',
  );
} finally {
  cleanup();
}
