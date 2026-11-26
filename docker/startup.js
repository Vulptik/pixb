const { spawnSync } = require('node:child_process');
const { prepareSecrets, bindSecrets } = require('./config');
const {
  databaseUrl,
  withClient,
  waitForDb,
  assertMigrationState,
  loadMigrations,
  checkRecovery,
} = require('./db-check');

async function startup(env = process.env, run = spawnSync) {
  const url = databaseUrl(env);
  const checksums = loadMigrations();
  console.log('Waiting for PostgreSQL...');
  await waitForDb(url);
  await withClient(url, (client) => assertMigrationState(client, [...checksums.keys()], checksums));
  const secrets = await withClient(url, (client) => prepareSecrets(client, env));
  console.log('Checking or creating the initial database schema...');
  const result = run(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    {
      env: { ...env, DATABASE_URL: url },
      stdio: 'inherit',
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      'Migration deployment failed. The app was not started; preserve the database and inspect migration logs.',
    );
  await withClient(url, (client) => bindSecrets(client, secrets));
  if (env.RECOVERY_MODE === 'true') {
    const armed = await withClient(url, checkRecovery);
    console.log(
      armed
        ? 'Recovery is enabled. Restrict access, complete /recover, then disable RECOVERY_MODE.'
        : 'Recovery was already consumed and remains disabled. Turn off RECOVERY_MODE.',
    );
  }
  console.log('Startup checks passed. Starting PixB.');
}

if (require.main === module) {
  startup().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { startup };
