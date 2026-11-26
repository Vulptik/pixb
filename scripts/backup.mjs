import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';

const composeFile = fileURLToPath(new URL('../compose.production.yml', import.meta.url));
const artifacts = ['database.dump', 'persistent.tar.gz', 'compose.production.yml'];
const volumeNames = ['config', 'database-secret', 'files', 'database'];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function docker(args, input) {
  const result = spawnSync('docker', args, { encoding: 'utf8', input, maxBuffer: 32 * 1024 ** 2 });
  if (result.error || result.status !== 0)
    throw new Error(result.stderr || 'Docker command failed.');
  return result.stdout.trim();
}
function inspect(kind, id) {
  return JSON.parse(docker([kind, 'inspect', id]))[0];
}
function projectName(project) {
  if (!/^[a-z0-9][a-z0-9_-]{2,62}$/.test(project) || ['pixb-next', 'pixb'].includes(project))
    throw new Error(
      'Specify a production-candidate project, never a development or legacy installation.',
    );
  return project;
}
function service(project, name) {
  const ids = docker([
    'ps',
    '-aq',
    '--filter',
    `label=com.docker.compose.project=${project}`,
    '--filter',
    `label=com.docker.compose.service=${name}`,
    '--filter',
    'label=com.docker.compose.oneoff=False',
  ])
    .split(/\s+/)
    .filter(Boolean);
  if (ids.length !== 1)
    throw new Error(`Expected exactly one ${name} container in the selected project.`);
  return inspect('container', ids[0]);
}
function environment(container) {
  return Object.fromEntries(
    container.Config.Env.map((value) => {
      const n = value.indexOf('=');
      return [value.slice(0, n), value.slice(n + 1)];
    }),
  );
}
function volume(container, target) {
  const mount = container.Mounts.find((item) => item.Destination === target);
  if (!mount || mount.Type !== 'volume')
    throw new Error('This procedure requires the named-volume production candidate.');
  return mount.Name;
}
function helper(image, volumes, command, writable = false) {
  return [
    'run',
    '--rm',
    '-i',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    '1001:1001',
    ...['config', 'database-secret', 'files'].flatMap((name) => [
      '--mount',
      `type=volume,source=${volumes[name]},target=${name === 'files' ? '/app/storage' : `/app/${name}`}${writable ? '' : ',readonly'}`,
    ]),
    '--entrypoint',
    'node',
    image,
    'docker/backup.js',
    command,
  ];
}
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function privateWrite(file, bytes) {
  const handle = await open(file, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
// Binary streams never pass through a shell, text conversion, or tool output.
async function transfer(args, file, direction) {
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let diagnostic = '';
  child.stderr.on('data', (chunk) => {
    diagnostic = (diagnostic + chunk.toString()).slice(-16000);
  });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(diagnostic || 'Backup transfer failed.')),
    );
  });
  // Attach rejection handlers immediately, including when the other stream fails.
  const operations = [done];
  if (direction === 'out') {
    child.stdin.end();
    operations.push(pipeline(child.stdout, createWriteStream(file, { flags: 'wx', mode: 0o600 })));
  } else {
    child.stdout.resume();
    operations.push(pipeline(createReadStream(file), child.stdin));
  }
  const result = await Promise.allSettled(operations);
  const failure = result.find((item) => item.status === 'rejected');
  if (failure) throw failure.reason;
  if (direction === 'out') {
    const handle = await open(file, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
export async function verify(directory) {
  directory = path.resolve(directory);
  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink())
    throw new Error('Backup must be a regular directory.');
  try {
    await lstat(path.join(directory, '.incomplete'));
    throw new Error('Backup is incomplete.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const manifestStat = await lstat(path.join(directory, 'manifest.json'));
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 1024 * 1024)
    throw new Error('Invalid backup manifest.');
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (
    manifest.format !== 'pixb-backup' ||
    manifest.version !== 1 ||
    manifest.storageRoot !== '/app/storage' ||
    !/^sha256:[a-f0-9]{64}$/.test(manifest.appImage) ||
    !/^sha256:[a-f0-9]{64}$/.test(manifest.databaseImage) ||
    manifest.postgresMajor !== 18 ||
    Object.keys(manifest.artifacts || {})
      .sort()
      .join('|') !== [...artifacts].sort().join('|')
  )
    throw new Error('Unsupported or incomplete backup manifest.');
  for (const name of artifacts) {
    const file = path.join(directory, name),
      info = await lstat(file),
      expected = manifest.artifacts[name];
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      !Number.isSafeInteger(expected.size) ||
      info.size !== expected.size ||
      !/^[a-f0-9]{64}$/.test(expected.sha256) ||
      (await hashFile(file)) !== expected.sha256
    )
      throw new Error(`Backup verification failed: ${name}`);
  }
  return manifest;
}
async function backup(project, directory) {
  projectName(project);
  const app = service(project, 'app'),
    db = service(project, 'db');
  const appEnv = environment(app),
    dbEnv = environment(db);
  if (
    appEnv.STORAGE_PATH !== '/app/storage' ||
    appEnv.DATABASE_HOST !== 'db' ||
    appEnv.DATABASE_URL ||
    appEnv.POSTGRES_USER !== 'pixb' ||
    appEnv.POSTGRES_DB !== 'pixb' ||
    appEnv.POSTGRES_PASSWORD_FILE !== '/run/pixb-database/postgres-password' ||
    appEnv.RECOVERY_MODE === 'true' ||
    dbEnv.POSTGRES_USER !== 'pixb' ||
    dbEnv.POSTGRES_DB !== 'pixb' ||
    dbEnv.POSTGRES_PASSWORD_FILE !== '/run/pixb-database/postgres-password' ||
    !db.State.Running
  )
    throw new Error('Unsupported deployment layout or recovery mode.');
  const volumes = {
    config: volume(app, '/app/config'),
    'database-secret': volume(app, '/run/pixb-database'),
    files: volume(app, '/app/storage'),
    database: volume(db, '/var/lib/postgresql'),
  };
  if (
    volume(db, '/run/pixb-database') !== volumes['database-secret'] ||
    new Set(Object.values(volumes)).size !== 4
  )
    throw new Error('Unexpected persistent volume layout.');
  if (
    JSON.parse(docker(['image', 'inspect', app.Image]))[0].Config.Labels?.['pixb.backup-format'] !==
    '1'
  )
    throw new Error('Build an image with the backup helper before using this procedure.');
  directory = path.resolve(directory);
  await mkdir(directory, { mode: 0o700 }); // Exclusive destination: never overwrite a backup.
  await privateWrite(path.join(directory, '.incomplete'), 'Backup is not complete.\n');
  const wasRunning = app.State.Running;
  let stopped;
  try {
    console.log('Pausing the selected PixB app; its database stays online.');
    if (wasRunning) docker(['stop', '--time', '30', app.Id]);
    stopped = inspect('container', app.Id).State;
    if (stopped.Running) throw new Error('PixB did not stop.');
    const query = (sql) =>
      docker(
        ['exec', '-i', db.Id, 'psql', '-U', 'pixb', '-d', 'pixb', '-v', 'ON_ERROR_STOP=1', '-At'],
        sql,
      );
    const version = query('SHOW server_version_num;');
    if (Math.floor(Number(version) / 10000) !== 18)
      throw new Error('This backup format currently supports PostgreSQL 18 only.');
    const references = query(
      "SELECT COALESCE(json_agg(json_build_object('path',file_data,'size',size::text)), '[]'::json) FROM medias;",
    );
    const checked = JSON.parse(docker(helper(app.Image, volumes, 'check'), references));
    if (
      checked.fingerprint !==
      query("SELECT value FROM settings WHERE key='instance.secrets_fingerprint';")
    )
      throw new Error('Persistent secrets do not match this database.');
    console.log('Capturing the database and all persistent files/secrets.');
    await transfer(
      [
        'exec',
        db.Id,
        'pg_dump',
        '-U',
        'pixb',
        '-d',
        'pixb',
        '--format=custom',
        '--no-owner',
        '--no-privileges',
      ],
      path.join(directory, 'database.dump'),
      'out',
    );
    await transfer(
      helper(app.Image, volumes, 'pack'),
      path.join(directory, 'persistent.tar.gz'),
      'out',
    );
    await privateWrite(path.join(directory, 'compose.production.yml'), await readFile(composeFile));
    const after = inspect('container', app.Id).State;
    if (after.Running || after.StartedAt !== stopped.StartedAt)
      throw new Error('PixB restarted during backup; this set is incomplete.');
    const manifest = {
      format: 'pixb-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      sourceProject: project,
      appImage: app.Image,
      databaseImage: db.Image,
      postgresMajor: 18,
      storageRoot: '/app/storage',
      publicUrl: appEnv.PUBLIC_URL,
      originals: checked.originals,
      artifacts: {},
    };
    for (const name of artifacts)
      manifest.artifacts[name] = {
        size: (await lstat(path.join(directory, name))).size,
        sha256: await hashFile(path.join(directory, name)),
      };
    await privateWrite(
      path.join(directory, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
    await unlink(path.join(directory, '.incomplete'));
    await verify(directory);
    console.log(`Backup complete: ${directory}`);
  } finally {
    if (wasRunning) {
      docker(['start', app.Id]);
      console.log('The source app has been restarted. Check its health before reopening access.');
    }
  }
}
async function restore(directory, publicUrl, deploymentDirectory) {
  const manifest = await verify(directory);
  // This first format deliberately refuses changed topology or automatic upgrades.
  if (digest(await readFile(composeFile)) !== manifest.artifacts['compose.production.yml'].sha256)
    throw new Error(
      'Deployment template differs. Use the matching PixB release/tools; restore is not an upgrade.',
    );
  const url = new URL(publicUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Supply an HTTP/HTTPS origin for the restored installation.');
  for (const image of [manifest.appImage, manifest.databaseImage]) inspect('image', image); // Require exact local images; never silently pull a replacement.
  const project = `pixb-restore-${randomBytes(6).toString('hex')}`;
  const claim = randomBytes(16).toString('hex');
  deploymentDirectory = path.resolve(deploymentDirectory);
  await mkdir(deploymentDirectory, { mode: 0o700 });
  await privateWrite(path.join(deploymentDirectory, 'RESTORE_INCOMPLETE'), `${project}\n`);
  console.log(`Restoring into fresh project ${project}; source installation is not modified.`);
  if (
    docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`]) ||
    docker(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`]) ||
    docker(['network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`])
  )
    throw new Error('Restore project already exists.');
  // Claim the network atomically. Failed restores retain their own resources for inspection.
  docker([
    'network',
    'create',
    '--label',
    `com.docker.compose.project=${project}`,
    '--label',
    'com.docker.compose.network=default',
    '--label',
    `pixb.restore.claim=${claim}`,
    `${project}_default`,
  ]);
  const volumes = {};
  for (const name of volumeNames) {
    const target = `${project}_${name}`;
    docker([
      'volume',
      'create',
      '--label',
      `com.docker.compose.project=${project}`,
      '--label',
      `com.docker.compose.volume=${name}`,
      '--label',
      `pixb.restore.claim=${claim}`,
      target,
    ]);
    if (inspect('volume', target).Labels['pixb.restore.claim'] !== claim)
      throw new Error('Restore volume already exists; refusing to write.');
    volumes[name] = target;
  }
  try {
    await transfer(
      helper(manifest.appImage, volumes, 'unpack', true),
      path.join(directory, 'persistent.tar.gz'),
      'in',
    );
    const env = {
      ...process.env,
      PIXB_IMAGE: manifest.appImage,
      PIXB_BIND_ADDRESS: '127.0.0.1',
      PIXB_PORT: '0',
      PUBLIC_URL: url.origin,
    };
    // Compose's DB image tag may drift. An override pins the recorded DB image ID.
    const override = JSON.stringify({ services: { db: { image: manifest.databaseImage } } });
    const compose = (args) => {
      const result = spawnSync(
        'docker',
        ['compose', '-p', project, '-f', composeFile, '-f', '-', ...args],
        { encoding: 'utf8', input: override, env },
      );
      if (result.error || result.status !== 0)
        throw new Error(result.stderr || 'Restore Compose command failed.');
      return result.stdout.trim();
    };
    compose(['up', '-d', '--no-build', '--wait', 'db']);
    const db = service(project, 'db');
    const count = docker([
      'exec',
      db.Id,
      'psql',
      '-U',
      'pixb',
      '-d',
      'pixb',
      '-Atc',
      "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';",
    ]);
    if (count !== '0') throw new Error('Restore database is not empty; refusing to import.');
    await transfer(
      [
        'exec',
        '-i',
        db.Id,
        'pg_restore',
        '-U',
        'pixb',
        '-d',
        'pixb',
        '--single-transaction',
        '--exit-on-error',
        '--no-owner',
        '--no-privileges',
      ],
      path.join(directory, 'database.dump'),
      'in',
    );
    const references = docker([
      'exec',
      db.Id,
      'psql',
      '-U',
      'pixb',
      '-d',
      'pixb',
      '-Atc',
      "SELECT COALESCE(json_agg(json_build_object('path',file_data,'size',size::text)), '[]'::json) FROM medias;",
    ]);
    const checked = JSON.parse(docker(helper(manifest.appImage, volumes, 'check'), references));
    const expected = docker([
      'exec',
      db.Id,
      'psql',
      '-U',
      'pixb',
      '-d',
      'pixb',
      '-Atc',
      "SELECT value FROM settings WHERE key='instance.secrets_fingerprint';",
    ]);
    if (checked.fingerprint !== expected || checked.originals !== manifest.originals)
      throw new Error('Restored database, files, and secrets do not match.');
    compose(['up', '-d', '--no-build', '--no-deps', '--wait', 'app']);
    const port = compose(['port', 'app', '3000']);
    const config = JSON.parse(compose(['config', '--format', 'json']));
    delete config.services['init-config'];
    delete config['x-pixb-image'];
    for (const item of Object.values(config.services)) delete item.build;
    config.services.app.ports[0].published = port.split(':').at(-1);
    const deploymentFile = path.join(deploymentDirectory, 'compose.restore.yml');
    await privateWrite(deploymentFile, JSON.stringify(config, null, 2) + '\n');
    await unlink(path.join(deploymentDirectory, 'RESTORE_INCOMPLETE'));
    console.log(`Restore ready: ${project} at http://${port}`);
    console.log(`Pinned deployment: ${deploymentFile}`);
    return { project, address: `http://${port}`, deploymentFile };
  } catch (error) {
    // Only this freshly claimed project's app can have been started here.
    try {
      const ids = docker([
        'ps',
        '-q',
        '--filter',
        `label=com.docker.compose.project=${project}`,
        '--filter',
        'label=com.docker.compose.service=app',
      ]);
      if (ids) docker(['stop', '--time', '30', ...ids.split(/\s+/)]);
    } catch {
      /* Preserve the primary restore error and its project identifier. */
    }
    throw new Error(
      `Restore failed in ${project}. Preserve its resources for inspection; do not initialize new secrets. ${error.message}`,
      { cause: error },
    );
  }
}
export async function main(args) {
  const [command, ...values] = args;
  if (command === 'backup' && values.length === 2) await backup(values[0], values[1]);
  else if (command === 'verify' && values.length === 1) {
    await verify(values[0]);
    console.log('Backup checksums verified. This does not replace a restore drill.');
  } else if (command === 'restore' && values.length === 3)
    return restore(values[0], values[1], values[2]);
  else
    throw new Error(
      'Usage: node scripts/backup.mjs backup PROJECT NEW_DIRECTORY | verify DIRECTORY | restore DIRECTORY PUBLIC_URL NEW_DEPLOYMENT_DIRECTORY',
    );
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
