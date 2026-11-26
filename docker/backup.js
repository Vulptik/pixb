// Runs only in a short-lived, non-root helper with explicit persistent mounts.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readConfig, fingerprint } = require('./config');

function walk(directory, empty = false) {
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe backup storage.');
  for (const entry of fs.readdirSync(directory)) {
    const file = path.join(directory, entry);
    const stat = fs.lstatSync(file);
    if (stat.isDirectory() && !stat.isSymbolicLink()) walk(file, empty);
    else if (!stat.isFile() || stat.isSymbolicLink() || empty)
      throw new Error(
        empty ? 'Restore storage is not empty.' : 'Backup requires regular files and directories.',
      );
  }
}
function check(references = []) {
  const config = readConfig();
  if (!config) throw new Error('Backup requires the original persistent secrets.');
  const password = '/app/database-secret/postgres-password';
  const stat = fs.lstatSync(password);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    fs.readFileSync(password, 'utf8').trim().length < 32
  )
    throw new Error('Database password file is invalid or insecure.');
  walk('/app/storage');
  for (const item of references) {
    if (
      typeof item.path !== 'string' ||
      !item.path.startsWith('/app/storage/uploads/') ||
      path.resolve(item.path) !== item.path
    )
      throw new Error('Database references unsupported storage paths.');
    const info = fs.lstatSync(item.path);
    if (!info.isFile() || info.isSymbolicLink() || String(info.size) !== item.size)
      throw new Error('An original file is missing or has an unexpected size.');
  }
  return { fingerprint: fingerprint(config), originals: references.length };
}
function main(command) {
  if (command === 'check') {
    const references = JSON.parse(fs.readFileSync(0, 'utf8') || '[]');
    if (!Array.isArray(references)) throw new Error('Invalid file references.');
    process.stdout.write(JSON.stringify(check(references)));
    return;
  }
  let args;
  if (command === 'pack') {
    check();
    args = [
      '-czf',
      '-',
      '-C',
      '/app',
      'config/secrets.json',
      'database-secret/postgres-password',
      'storage',
    ];
  } else if (command === 'unpack') {
    for (const directory of ['/app/config', '/app/database-secret', '/app/storage'])
      walk(directory, true);
    args = ['-xzf', '-', '-C', '/app', '--no-same-owner', '--keep-old-files'];
  } else throw new Error('Unsupported backup helper command.');
  const result = spawnSync('tar', args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error('Backup archive operation failed.');
  if (command === 'unpack') check();
}
if (require.main === module) {
  try {
    main(process.argv[2]);
  } catch (error) {
    console.error(error.code ? 'Backup storage is unreadable or incomplete.' : error.message);
    process.exitCode = 1;
  }
}
module.exports = { walk, check };
