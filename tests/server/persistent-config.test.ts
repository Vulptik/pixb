import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  symlinkSync,
} from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const {
  prepareSecrets,
  readConfig,
  configFile,
  fingerprint,
  initialize,
} = require('../../docker/config.js');
let directory: string;
let env: Record<string, string>;
beforeEach(() => {
  const root = path.resolve('.local-rebuild');
  mkdirSync(root, { recursive: true });
  directory = mkdtempSync(path.join(root, 'persistent-config-'));
  env = {
    PIXB_CONFIG_PATH: path.join(directory, 'config'),
    PIXB_DATABASE_SECRET_PATH: path.join(directory, 'db-secret'),
  };
});
afterEach(() => {
  const root = path.resolve('.local-rebuild') + path.sep;
  if (!directory.startsWith(root) || !path.basename(directory).startsWith('persistent-config-'))
    throw new Error('Unsafe test cleanup target');
  rmSync(directory, { recursive: true, force: true });
});
function database(expected: string | null = null, populated = false) {
  return {
    query: vi.fn(async (query: string) => {
      if (query.includes('to_regclass')) return { rows: [{ has_settings: true, has_users: true }] };
      if (query.includes('SELECT value')) return { rows: expected ? [{ value: expected }] : [] };
      return { rows: [{ populated }] };
    }),
  };
}
it('generates private independent keys once and reuses the exact file', async () => {
  const first = await prepareSecrets(database(), env);
  expect(first.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
  expect(first.JWT_SECRET).not.toBe(first.ENCRYPTION_KEY);
  const bytes = readFileSync(configFile(env), 'utf8');
  expect(await prepareSecrets(database(fingerprint(first), true), env)).toEqual(first);
  expect(readFileSync(configFile(env), 'utf8')).toBe(bytes);
});
it('refuses to generate keys when an existing database has lost its config', async () => {
  await expect(prepareSecrets(database('existing-fingerprint', true), env)).rejects.toThrow(
    'Persistent secrets are missing',
  );
  expect(existsSync(configFile(env))).toBe(false);
});
it('refuses an unbound populated installation without the original environment keys', async () => {
  await expect(prepareSecrets(database(null, true), env)).rejects.toThrow(
    'replacement keys will not be generated',
  );
});
it('imports explicit original keys and rejects future environment changes', async () => {
  env.JWT_SECRET = 'original-jwt-'.repeat(4);
  env.ENCRYPTION_KEY = 'original-encryption-'.repeat(3);
  const config = await prepareSecrets(database(null, true), env);
  expect(config.JWT_SECRET).toBe(env.JWT_SECRET);
  const bytes = readFileSync(configFile(env), 'utf8');
  await expect(
    prepareSecrets(database(fingerprint(config), true), {
      ...env,
      JWT_SECRET: 'changed-key-'.repeat(4),
    }),
  ).rejects.toThrow('conflict');
  expect(readFileSync(configFile(env), 'utf8')).toBe(bytes);
});
it('refuses a valid config that belongs to another database', async () => {
  await prepareSecrets(database(), env);
  await expect(prepareSecrets(database('another-installation', true), env)).rejects.toThrow(
    'do not match',
  );
});
it('does not overwrite corrupted or truncated config even when original environment keys are provided', async () => {
  await prepareSecrets(database(), env);
  writeFileSync(configFile(env), '{"version":', { mode: 0o600 });
  await expect(prepareSecrets(database(), env)).rejects.toThrow('will not be replaced');
  expect(readFileSync(configFile(env), 'utf8')).toBe('{"version":');
});
it('rejects partial environment key imports', async () => {
  await expect(
    prepareSecrets(database(), { ...env, JWT_SECRET: 'one-key-'.repeat(8) }),
  ).rejects.toThrow('both original');
  expect(existsSync(configFile(env))).toBe(false);
});
it('initializes both kinds of secrets explicitly without rotating either on a repeat', () => {
  expect(initialize(env)).toBe('created');
  const file = path.join(env.PIXB_DATABASE_SECRET_PATH, 'postgres-password');
  const password = readFileSync(file, 'utf8');
  const config = readConfig(env);
  expect(initialize(env)).toBe('kept');
  expect(readConfig(env)).toEqual(config);
  expect(readFileSync(file, 'utf8')).toBe(password);
  expect(password.trim().length).toBeGreaterThanOrEqual(32);
});
it('reports whether init-config created secrets or kept existing ones', () => {
  // Run the real command, without the keys the test setup puts in the environment.
  const childEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !['JWT_SECRET', 'ENCRYPTION_KEY', 'NEXTAUTH_SECRET'].includes(name),
    ),
  );
  const run = () =>
    spawnSync(process.execPath, ['docker/config.js', 'initialize'], {
      env: { ...childEnv, ...env },
      encoding: 'utf8',
    });
  const first = run();
  expect(first.status).toBe(0);
  expect(first.stdout.trim()).toBe('Installation secrets created.');
  const second = run();
  expect(second.status).toBe(0);
  expect(second.stdout.trim()).toBe('Installation secrets already exist and were kept unchanged.');
});
it('refuses incomplete initialization instead of inventing a missing database password', () => {
  initialize(env);
  const file = path.join(env.PIXB_DATABASE_SECRET_PATH, 'postgres-password');
  rmSync(file);
  expect(() => initialize(env)).toThrow('Incomplete');
  expect(existsSync(file)).toBe(false);
});
function catalogMounts() {
  env.PIXB_DATABASE_STATE_PATH = path.join(directory, 'database');
  env.STORAGE_PATH = path.join(directory, 'files');
  mkdirSync(env.PIXB_DATABASE_STATE_PATH);
  mkdirSync(path.join(env.STORAGE_PATH, 'uploads'), { recursive: true });
}
it('automatically initializes empty catalog mounts and preserves secrets after data arrives', () => {
  catalogMounts();
  initialize(env, { automatic: true });
  const passwordFile = path.join(env.PIXB_DATABASE_SECRET_PATH, 'postgres-password');
  const originalConfig = readFileSync(configFile(env));
  const originalPassword = readFileSync(passwordFile);
  writeFileSync(path.join(env.PIXB_DATABASE_STATE_PATH, 'PG_VERSION'), '18');
  writeFileSync(path.join(env.STORAGE_PATH, 'uploads', 'original'), 'existing file');
  initialize(env, { automatic: true });
  expect(readFileSync(configFile(env))).toEqual(originalConfig);
  expect(readFileSync(passwordFile)).toEqual(originalPassword);
});
it.each([
  ['PIXB_DATABASE_STATE_PATH', 'PG_VERSION', 'Existing database data'],
  ['STORAGE_PATH', 'uploads/original', 'Existing library data'],
])('does not create replacement catalog secrets for populated %s', (mount, entry, message) => {
  catalogMounts();
  writeFileSync(path.join(env[mount], entry), 'existing data');
  expect(() => initialize(env, { automatic: true })).toThrow(message);
  expect(existsSync(configFile(env))).toBe(false);
  expect(existsSync(path.join(env.PIXB_DATABASE_SECRET_PATH, 'postgres-password'))).toBe(false);
});
it('requires explicit mounts before automatically creating catalog secrets', () => {
  expect(() => initialize(env, { automatic: true })).toThrow('absolute database and library');
  expect(existsSync(configFile(env))).toBe(false);
});
it.skipIf(process.platform === 'win32')(
  'rejects symlinks instead of reading another file as config',
  async () => {
    mkdirSync(env.PIXB_CONFIG_PATH);
    const target = path.join(directory, 'elsewhere');
    writeFileSync(target, '{}');
    symlinkSync(target, configFile(env));
    expect(() => readConfig(env)).toThrow('private regular file');
  },
);
