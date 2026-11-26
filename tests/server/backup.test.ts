import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
// @ts-expect-error Operator CLI is native JavaScript, independent of the app's TS build.
import { verify } from '../../scripts/backup.mjs';
let directory: string;
let manifest: Record<string, unknown>;
beforeEach(() => {
  const root = path.resolve('.local-rebuild');
  mkdirSync(root, { recursive: true });
  directory = mkdtempSync(path.join(root, 'backup-unit-'));
  const artifacts: Record<string, { size: number; sha256: string }> = {};
  for (const name of ['database.dump', 'persistent.tar.gz', 'compose.production.yml']) {
    const bytes = Buffer.from(`fixture ${name}`);
    writeFileSync(path.join(directory, name), bytes);
    artifacts[name] = {
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }
  manifest = {
    format: 'pixb-backup',
    version: 1,
    storageRoot: '/app/storage',
    appImage: `sha256:${'a'.repeat(64)}`,
    databaseImage: `sha256:${'b'.repeat(64)}`,
    postgresMajor: 18,
    artifacts,
  };
  save();
});
function save() {
  writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
}
afterEach(() => {
  if (
    !directory.startsWith(path.resolve('.local-rebuild') + path.sep) ||
    !path.basename(directory).startsWith('backup-unit-')
  )
    throw new Error('Unsafe test cleanup');
  rmSync(directory, { recursive: true, force: true });
});
it('accepts a complete set only when every artifact matches its size and checksum', async () => {
  expect(await verify(directory)).toMatchObject({ version: 1, postgresMajor: 18 });
});
it.each(['database.dump', 'persistent.tar.gz', 'compose.production.yml'])(
  'refuses corruption of %s',
  async (name) => {
    writeFileSync(path.join(directory, name), 'corrupt');
    await expect(verify(directory)).rejects.toThrow('Backup verification failed');
  },
);
it('refuses an interrupted backup even if a manifest is present', async () => {
  writeFileSync(path.join(directory, '.incomplete'), 'interrupted');
  await expect(verify(directory)).rejects.toThrow('incomplete');
});
it('refuses unknown format versions and mutable image tags', async () => {
  manifest.version = 2;
  save();
  await expect(verify(directory)).rejects.toThrow('Unsupported');
  manifest.version = 1;
  manifest.appImage = 'pixb:latest';
  save();
  await expect(verify(directory)).rejects.toThrow('Unsupported');
});
it('refuses missing artifacts and arbitrary manifest paths', async () => {
  manifest.artifacts = { '../secrets.json': { size: 1, sha256: 'a'.repeat(64) } };
  save();
  await expect(verify(directory)).rejects.toThrow('Unsupported');
});
it.skipIf(process.platform === 'win32')('refuses symlinked artifacts', async () => {
  rmSync(path.join(directory, 'database.dump'));
  symlinkSync('persistent.tar.gz', path.join(directory, 'database.dump'));
  await expect(verify(directory)).rejects.toThrow('Backup verification failed');
});
