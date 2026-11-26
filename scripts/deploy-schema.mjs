// A fresh-project Prisma baseline, guarded exactly like container startup.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('dotenv/config');
const {
  databaseUrl,
  loadMigrations,
  assertMigrationState,
  withClient,
  waitForDb,
} = require('../docker/db-check.js');

const url = databaseUrl();
const checksums = loadMigrations();
await waitForDb(url);
await withClient(url, (client) => assertMigrationState(client, [...checksums.keys()], checksums));
const result = spawnSync(
  process.execPath,
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
