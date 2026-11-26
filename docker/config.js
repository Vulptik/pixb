const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FINGERPRINT_KEY = 'instance.secrets_fingerprint';
const secretNames = ['JWT_SECRET', 'ENCRYPTION_KEY'];
function configFile(env = process.env) {
  const directory = env.PIXB_CONFIG_PATH || '/app/config';
  if (!path.isAbsolute(directory))
    throw new Error('PIXB_CONFIG_PATH must be an absolute persistent directory.');
  return path.join(directory, 'secrets.json');
}

function validate(config) {
  if (
    config?.version !== 1 ||
    secretNames.some(
      (name) =>
        typeof config[name] !== 'string' ||
        config[name].length < 32 ||
        /[\r\n\0]/.test(config[name]),
    )
  ) {
    throw new Error(
      'Persistent secrets are invalid or unsupported. Restore the original config; it will not be replaced.',
    );
  }
  if (config.JWT_SECRET === config.ENCRYPTION_KEY)
    throw new Error('Signing and encryption keys must be different.');
  return config;
}
function readConfig(env = process.env) {
  const file = configFile(env);
  let info;
  try {
    const directory = fs.lstatSync(path.dirname(file));
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw new Error('Invalid config directory');
    info = fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Cannot read persistent config. Check the config mount and permissions.', {
      cause: error,
    });
  }
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > 16384 ||
    (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
  ) {
    throw new Error(
      'Persistent secrets must be a private regular file (mode 0600). Check ownership and permissions.',
    );
  }
  try {
    return validate(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    throw new Error(
      'Persistent secrets are invalid or unreadable. Restore the original config; it will not be replaced.',
    );
  }
}
function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('Secret storage must be a real directory, not a symlink.');
}
// Publish a fully written file without overwriting an existing file. The hard
// link makes concurrent initializers agree on the first completed writer.
function publish(file, value) {
  ensureDirectory(path.dirname(file));
  const temporary = path.join(path.dirname(file), `.pixb-${crypto.randomUUID()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, value);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    try {
      fs.linkSync(temporary, file);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    if (process.platform !== 'win32') {
      const dir = fs.openSync(path.dirname(file), 'r');
      try {
        fs.fsyncSync(dir);
      } finally {
        fs.closeSync(dir);
      }
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    // Only the temporary file created by this call is removed; never the
    // published config, including when another initializer won the race.
    fs.rmSync(temporary, { force: true });
  }
}
function freshSecrets() {
  return {
    version: 1,
    JWT_SECRET: crypto.randomBytes(32).toString('base64url'),
    ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64url'),
  };
}
function fingerprint(config) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(['pixb-secrets-v1', ...secretNames.map((name) => config[name])]))
    .digest('hex');
}
function suppliedPair(env) {
  return secretNames.every((name) => Boolean(env[name]));
}
function assertEnvironment(config, env) {
  for (const name of secretNames) {
    if (env[name] && env[name] !== config[name])
      throw new Error(
        'Environment keys conflict with persistent secrets. Restore the original keys; automatic rotation is refused.',
      );
  }
}
async function inspectIdentity(client) {
  const {
    rows: [tables],
  } = await client.query(
    "SELECT to_regclass('public.settings') IS NOT NULL AS has_settings, to_regclass('public.users') IS NOT NULL AS has_users",
  );
  let expected = null,
    populated = false;
  if (tables.has_settings) {
    const { rows } = await client.query('SELECT value FROM public.settings WHERE key = $1', [
      FINGERPRINT_KEY,
    ]);
    expected = rows[0]?.value ?? null;
    populated = (await client.query('SELECT EXISTS (SELECT 1 FROM public.settings) AS populated'))
      .rows[0].populated;
  }
  if (tables.has_users)
    populated ||= (await client.query('SELECT EXISTS (SELECT 1 FROM public.users) AS populated'))
      .rows[0].populated;
  return { expected, populated };
}
async function prepareSecrets(client, env = process.env) {
  const identity = await inspectIdentity(client);
  let config = readConfig(env);
  if (config) assertEnvironment(config, env);
  if (!config) {
    if (secretNames.some((name) => Boolean(env[name])) && !suppliedPair(env))
      throw new Error(
        'Supply both original application keys when importing an existing installation.',
      );
    if (!suppliedPair(env) && (identity.expected || identity.populated))
      throw new Error(
        'Persistent secrets are missing for an existing database. Restore the config backup; replacement keys will not be generated.',
      );
    config = suppliedPair(env)
      ? validate({
          version: 1,
          ...Object.fromEntries(secretNames.map((name) => [name, env[name]])),
        })
      : freshSecrets();
  }
  if (identity.expected && identity.expected !== fingerprint(config))
    throw new Error(
      'Persistent secrets do not match this database. Restore its matching config; startup is refused.',
    );
  if (!identity.expected && identity.populated && !suppliedPair(env))
    throw new Error(
      'Existing unbound database requires both original environment keys for the first import.',
    );
  if (!readConfig(env)) {
    publish(configFile(env), JSON.stringify(config) + '\n');
    config = readConfig(env);
    assertEnvironment(config, env);
    if (identity.expected && identity.expected !== fingerprint(config))
      throw new Error('Concurrent config does not match the database. Startup is refused.');
  }
  return config;
}
async function bindSecrets(client, config) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(744205909330015334)');
    await client.query(
      `INSERT INTO public.settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO NOTHING`,
      [FINGERPRINT_KEY, fingerprint(config)],
    );
    const { rows } = await client.query('SELECT value FROM public.settings WHERE key = $1', [
      FINGERPRINT_KEY,
    ]);
    if (rows[0]?.value !== fingerprint(config))
      throw new Error('Persistent secrets do not match the database. Startup is refused.');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
function catalogDataEntries(directory) {
  if (!directory || !path.isAbsolute(directory))
    throw new Error('Catalog initialization requires absolute database and library mount paths.');
  if (!fs.lstatSync(directory).isDirectory())
    throw new Error('Catalog installation storage must be a real directory.');
  return fs.readdirSync(directory, { withFileTypes: true });
}
function libraryIsEmpty(directory) {
  return catalogDataEntries(directory).every(
    (entry) => entry.isDirectory() && libraryIsEmpty(path.join(directory, entry.name)),
  );
}
function initialize(env = process.env, { automatic = false } = {}) {
  const databaseDirectory = env.PIXB_DATABASE_SECRET_PATH || '/app/database-secret';
  if (!path.isAbsolute(databaseDirectory))
    throw new Error('PIXB_DATABASE_SECRET_PATH must be absolute.');
  const databaseFile = path.join(databaseDirectory, 'postgres-password');
  const config = readConfig(env);
  const info = fs.lstatSync(databaseFile, { throwIfNoEntry: false });
  if (config || info) {
    if (!config || !info)
      throw new Error(
        'Incomplete installation secrets. Restore the matching files; initialize will not replace them.',
      );
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (process.platform !== 'win32' && (info.mode & 0o077) !== 0) ||
      fs.readFileSync(databaseFile, 'utf8').trim().length < 32
    )
      throw new Error('Database password file is invalid or insecure. Restore the original file.');
    assertEnvironment(config, env);
    return 'kept';
  }
  if (secretNames.some((name) => Boolean(env[name])))
    throw new Error(
      'Fresh initialization does not import environment keys. Use normal startup with both original keys to import an existing installation.',
    );
  if (automatic) {
    if (catalogDataEntries(env.PIXB_DATABASE_STATE_PATH).length)
      throw new Error('Existing database data found. Restore the original installation secrets.');
    if (!libraryIsEmpty(env.STORAGE_PATH))
      throw new Error('Existing library data found. Restore the original installation secrets.');
  }
  publish(configFile(env), JSON.stringify(freshSecrets()) + '\n');
  publish(databaseFile, crypto.randomBytes(32).toString('base64url') + '\n');
  return 'created';
}
const initializeMessages = {
  created: 'Installation secrets created.',
  kept: 'Installation secrets already exist and were kept unchanged.',
};
if (require.main === module) {
  try {
    if (process.argv[2] === 'initialize' || process.argv[2] === 'initialize-catalog') {
      const result = initialize(process.env, {
        automatic: process.argv[2] === 'initialize-catalog',
      });
      console.log(initializeMessages[result]);
    } else if (process.argv[2] === 'value' && secretNames.includes(process.argv[3])) {
      const config = readConfig();
      if (!config) throw new Error('Persistent secrets are missing. Refusing to start.');
      process.stdout.write(config[process.argv[3]]);
    } else throw new Error('Unsupported config command.');
  } catch (error) {
    console.error(
      error.code
        ? 'Secret storage is unavailable. Check the persistent mounts and permissions.'
        : error.message,
    );
    process.exitCode = 1;
  }
}
module.exports = {
  configFile,
  readConfig,
  publish,
  freshSecrets,
  fingerprint,
  prepareSecrets,
  bindSecrets,
  initialize,
};
