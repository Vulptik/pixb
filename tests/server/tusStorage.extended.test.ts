import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  files: new Map<string, object>(),
  lstat: vi.fn(),
  readdir: vi.fn(),
  rm: vi.fn(),
  warn: vi.fn(),
  cleanupGate: vi.fn(),
}));
vi.mock('fs/promises', () => ({ lstat: state.lstat, readdir: state.readdir, rm: state.rm }));
vi.mock('@/lib/server/logger', () => ({ logger: { info: vi.fn(), warn: state.warn } }));
vi.mock('@/lib/server/tusActivity', () => ({
  withTusCleanup: state.cleanupGate,
}));

import { cleanupStaleTusUploads } from '@/lib/server/tusStorage';

const directory = path.join(process.cwd(), 'storage', 'tus-uploads');
const old = Date.now() - 25 * 60 * 60 * 1000;
function file(mtimeMs = old, overrides = {}) {
  return {
    mtimeMs,
    ino: 1,
    dev: 1,
    size: 12,
    isFile: () => true,
    isSymbolicLink: () => false,
    ...overrides,
  };
}
function add(name: string, value = file()) {
  state.files.set(path.join(directory, name), value);
}

beforeEach(() => {
  vi.resetAllMocks();
  state.cleanupGate.mockImplementation((cleanup: (assertLock: () => void) => Promise<number>) =>
    cleanup(() => {}),
  );
  state.files.clear();
  state.lstat.mockImplementation(async (name: string) => {
    if (name === directory) return { isDirectory: () => true, isSymbolicLink: () => false };
    const value = state.files.get(name);
    if (value) return value;
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  });
  state.readdir.mockResolvedValue([]);
  state.rm.mockResolvedValue(undefined);
});

describe('stale TUS upload cleanup', () => {
  it('reports a busy activity gate without scanning or deleting upload files', async () => {
    state.cleanupGate.mockResolvedValueOnce(null);
    expect(await cleanupStaleTusUploads()).toBeNull();
    expect(state.readdir).not.toHaveBeenCalled();
    expect(state.rm).not.toHaveBeenCalled();
  });

  it('removes an abandoned upload pair once and preserves recent data or metadata', async () => {
    state.readdir.mockResolvedValue(['old', 'old.json', 'active', 'active.json', 'recent']);
    add('old');
    add('old.json');
    add('active');
    add('active.json', file(Date.now()));
    add('recent', file(Date.now()));
    expect(await cleanupStaleTusUploads()).toBe(1);
    expect(state.rm.mock.calls).toEqual([
      [path.join(directory, 'old'), { force: true }],
      [path.join(directory, 'old.json'), { force: true }],
    ]);
  });

  it('cleans aged metadata-only uploads and finalization staging files', async () => {
    state.readdir.mockResolvedValue(['abandoned.json', 'finalize-123']);
    add('abandoned.json');
    add('finalize-123');
    expect(await cleanupStaleTusUploads()).toBe(2);
    expect(state.rm).toHaveBeenCalledWith(path.join(directory, 'abandoned.json'), { force: true });
    expect(state.rm).toHaveBeenCalledWith(path.join(directory, 'finalize-123'), { force: true });
  });

  it('retains a pair at the 24-hour boundary', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    state.readdir.mockResolvedValue(['boundary']);
    add('boundary', file(now - 24 * 60 * 60 * 1000));
    expect(await cleanupStaleTusUploads()).toBe(0);
    expect(state.rm).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('skips symlinks, directories, unrelated names and invalid paths', async () => {
    state.readdir.mockResolvedValue([
      'link',
      'dir',
      'unsafe',
      'unsafe.json',
      '.DS_Store',
      'notes.txt',
      '../escape',
    ]);
    add('link', file(old, { isSymbolicLink: () => true }));
    add('dir', file(old, { isFile: () => false }));
    add('unsafe');
    add('unsafe.json', file(old, { isSymbolicLink: () => true }));
    expect(await cleanupStaleTusUploads()).toBe(0);
    expect(state.rm).not.toHaveBeenCalled();
  });

  it('retains files resumed or replaced during the scan', async () => {
    state.readdir.mockResolvedValue(['resumed']);
    add('resumed');
    let reads = 0;
    state.lstat.mockImplementation(async (name: string) => {
      if (name === directory) return { isDirectory: () => true, isSymbolicLink: () => false };
      if (name === path.join(directory, 'resumed'))
        return ++reads === 1 ? file() : file(Date.now());
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });
    expect(await cleanupStaleTusUploads()).toBe(0);
    expect(state.rm).not.toHaveBeenCalled();
  });

  it('treats missing storage and files disappearing during scanning as empty', async () => {
    state.readdir.mockResolvedValue(['gone']);
    expect(await cleanupStaleTusUploads()).toBe(0);
    state.readdir.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    expect(await cleanupStaleTusUploads()).toBe(0);
  });

  it('rejects a symlinked upload directory', async () => {
    state.lstat.mockResolvedValue({ isDirectory: () => true, isSymbolicLink: () => true });
    await expect(cleanupStaleTusUploads()).rejects.toThrow('could not read storage');
    expect(state.readdir).not.toHaveBeenCalled();
  });

  it('reports inaccessible storage so scheduled maintenance can retry', async () => {
    state.readdir.mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
    await expect(cleanupStaleTusUploads()).rejects.toThrow('could not read storage');
    expect(state.warn).toHaveBeenCalledWith({ code: 'EACCES' }, expect.any(String));
  });

  it('reports inspection and deletion failures without silently counting success', async () => {
    state.readdir.mockResolvedValue(['broken']);
    add('broken');
    state.rm.mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
    await expect(cleanupStaleTusUploads()).rejects.toThrow('could not remove temporary files');
    state.lstat.mockRejectedValueOnce(Object.assign(new Error('I/O'), { code: 'EIO' }));
    await expect(cleanupStaleTusUploads()).rejects.toThrow('could not read storage');
  });
});
