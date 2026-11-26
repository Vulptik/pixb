import { spawnSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { patchReactDevTiming } from './patch-react-dev-timing.mjs';
mkdirSync('.local-rebuild', { recursive: true, mode: 0o700 });
const configFile = resolve('.local-rebuild/config.json');
if (!existsSync(configFile))
  writeFileSync(
    configFile,
    JSON.stringify({
      dbPassword: randomBytes(24).toString('hex'),
      jwt: randomBytes(32).toString('hex'),
      encryption: randomBytes(32).toString('hex'),
    }),
    { mode: 0o600 },
  );
const config = JSON.parse(readFileSync(configFile, 'utf8'));
const { PIXB_LOCAL_ADMIN_PASSWORD, ...localEnvironment } = process.env;
const env = {
  ...localEnvironment,
  PIXB_LOCAL_DB_PASSWORD: config.dbPassword,
  DATABASE_URL: `postgresql://pixb:${config.dbPassword}@127.0.0.1:5435/pixb`,
  JWT_SECRET: config.jwt,
  ENCRYPTION_KEY: config.encryption,
  STORAGE_PATH: resolve('storage'),
  FFMPEG_PATH:
    process.env.FFMPEG_PATH ||
    resolve('node_modules/ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
  PORT: '3001',
  HOSTNAME: '127.0.0.1',
  PUBLIC_URL: 'http://localhost:3001',
  PIXB_LOCAL_DEV: '1',
  NEXT_TELEMETRY_DISABLED: '1',
};
function run(command, args, environment = env) {
  const result = spawnSync(command, args, { env: environment, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (process.argv.includes('--exec')) {
  const args = process.argv.slice(process.argv.indexOf('--exec') + 1);
  run(process.execPath, args);
  process.exit(0);
}
run('docker', ['compose', '-f', 'compose.local.yml', 'up', '-d', '--build', '--wait', 'db']);
run(process.execPath, ['scripts/deploy-schema.mjs']);
run(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/seed-local.ts'], {
  ...env,
  PIXB_LOCAL_ADMIN_PASSWORD,
});
if (process.argv.includes('--prepare')) process.exit(0);
patchReactDevTiming();
const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'dev', '--webpack', '-H', env.HOSTNAME, '-p', env.PORT],
  { env, stdio: 'inherit' },
);
child.on('exit', (code) => process.exit(code ?? 0));
