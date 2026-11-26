const { Client } = require('pg');
const { readFileSync, readdirSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');

function loadMigrations() {
  const root = path.join(__dirname, '../prisma/migrations');
  const checksums = new Map(
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => [
        entry.name,
        createHash('sha256')
          .update(readFileSync(path.join(root, entry.name, 'migration.sql')))
          .digest('hex'),
      ]),
  );
  if (!checksums.size) throw new Error('No initial schema is packaged. Refusing to start.');
  return checksums;
}

function databaseUrl(env = process.env) {
  if (env.DATABASE_URL) {
    const schema = new URL(env.DATABASE_URL).searchParams.get('schema');
    if (schema && schema !== 'public')
      throw new Error('Container startup supports only the public database schema.');
    return env.DATABASE_URL;
  }
  const { DATABASE_HOST, POSTGRES_USER, POSTGRES_DB } = env;
  if (env.POSTGRES_PASSWORD && env.POSTGRES_PASSWORD_FILE)
    throw new Error('Use either POSTGRES_PASSWORD or POSTGRES_PASSWORD_FILE, not both.');
  let POSTGRES_PASSWORD = env.POSTGRES_PASSWORD;
  if (env.POSTGRES_PASSWORD_FILE) {
    try {
      POSTGRES_PASSWORD = readFileSync(env.POSTGRES_PASSWORD_FILE, 'utf8').replace(/\r?\n$/, '');
    } catch {
      throw new Error(
        'Cannot read POSTGRES_PASSWORD_FILE. Restore the database password file and check permissions.',
      );
    }
  }
  if (!DATABASE_HOST || !POSTGRES_USER || !POSTGRES_PASSWORD || !POSTGRES_DB) {
    throw new Error(
      'Set DATABASE_URL or all DATABASE_HOST/POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB variables.',
    );
  }
  const host =
    DATABASE_HOST.includes(':') && !DATABASE_HOST.startsWith('[')
      ? `[${DATABASE_HOST}]`
      : DATABASE_HOST;
  return `postgresql://${encodeURIComponent(POSTGRES_USER)}:${encodeURIComponent(POSTGRES_PASSWORD)}@${host}:${env.DATABASE_PORT || '5432'}/${encodeURIComponent(POSTGRES_DB)}?schema=public`;
}

async function withClient(url, action) {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    return await action(client);
  } finally {
    await client.end();
  }
}

async function waitForDb(
  url,
  attempts = 30,
  delay = (ms) => new Promise((r) => setTimeout(r, ms)),
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await withClient(url, (client) => client.query('SELECT 1'));
      return;
    } catch {
      if (attempt + 1 < attempts) await delay(2000);
    }
  }
  throw new Error(
    'PostgreSQL is unavailable. Check the database service, credentials, and network; no schema changes were made.',
  );
}

// Read-only preflight. Prisma remains responsible for applying migrations.
async function assertMigrationState(client, migrationNames, checksums = new Map()) {
  const {
    rows: [schema],
  } = await client.query(`SELECT
    to_regclass('public._prisma_migrations') IS NOT NULL AS has_history,
    EXISTS (SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name <> '_prisma_migrations') AS has_tables`);
  if (!schema.has_history) {
    if (schema.has_tables)
      throw new Error(
        'Existing schema has no Prisma history. Use a separate empty database; startup will not baseline or reset it.',
      );
    return;
  }
  const { rows } = await client.query(
    'SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations',
  );
  if (rows.some((row) => !row.finished_at && !row.rolled_back_at)) {
    throw new Error(
      'A migration failed or was interrupted. Preserve the database and inspect its migration logs or restore a backup; startup will not reset or resolve it.',
    );
  }
  const applied = rows.filter((row) => row.finished_at && !row.rolled_back_at);
  if (schema.has_tables && applied.length === 0) {
    throw new Error(
      'Existing schema has no successfully applied migrations. Use a separate empty database or inspect migration history; no automatic baseline is allowed.',
    );
  }
  if (applied.some((row) => !migrationNames.includes(row.migration_name))) {
    throw new Error(
      'Database migration history is newer than or different from this image. Use the matching image or restore a compatible backup.',
    );
  }
  if (
    applied.some(
      (row) =>
        checksums.has(row.migration_name) && checksums.get(row.migration_name) !== row.checksum,
    )
  ) {
    throw new Error(
      'The initial schema differs from this image. Preserve the existing database and use a separate fresh database or its matching image; startup will not rewrite it.',
    );
  }
}

// Explicit operator action, never called during startup. Restarts must not
// re-enable a recovery session that has already been consumed.
async function armRecovery(client) {
  const { rows } = await client.query(
    'SELECT id FROM public.users WHERE role = 1 ORDER BY id LIMIT 1',
  );
  if (!rows.length) throw new Error('No administrator exists. Complete first setup instead.');
  await client.query(`INSERT INTO public.settings (key, value, updated_at) VALUES ('recovery.used', 'false', CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = 'false', updated_at = CURRENT_TIMESTAMP`);
}

async function checkRecovery(client) {
  const { rows } = await client.query(
    "SELECT value FROM public.settings WHERE key = 'recovery.used'",
  );
  if (!rows.length || !['true', 'false'].includes(rows[0].value)) {
    throw new Error(
      'Recovery was not armed. Restrict access to this instance and run node docker/db-check.js arm-recovery, then start with RECOVERY_MODE=true.',
    );
  }
  return rows[0].value === 'false';
}

async function main() {
  if (process.argv[2] === 'database-url') {
    process.stdout.write(databaseUrl());
    return;
  }
  if (process.argv[2] !== 'arm-recovery')
    throw new Error('Supported operator command: arm-recovery');
  await withClient(databaseUrl(), armRecovery);
  console.log(
    'Recovery armed. Restrict access to the instance, enable RECOVERY_MODE=true, and open /recover. Disable recovery mode after use.',
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      process.argv[2] === 'database-url'
        ? error.message
        : 'Recovery could not be armed. Check database configuration, schema, and administrator setup; no automatic recovery is performed.',
    );
    process.exitCode = 1;
  });
}

module.exports = {
  databaseUrl,
  withClient,
  waitForDb,
  loadMigrations,
  assertMigrationState,
  armRecovery,
  checkRecovery,
};
