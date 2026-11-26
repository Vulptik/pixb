import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn(),
}));

vi.mock('fs/promises', () => fsMock);

describe('tus storage helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ensures upload directory exists', async () => {
    const { ensureTusUploadDir } = await import('@/lib/server/tusStorage');
    await ensureTusUploadDir();
    const expectedDir = path.join(process.cwd(), 'storage', 'tus-uploads');
    expect(fsMock.mkdir).toHaveBeenCalledWith(expectedDir, { recursive: true });
  });

  it('builds upload paths', async () => {
    const { getTusUploadPath } = await import('@/lib/server/tusStorage');
    const baseDir = path.join(process.cwd(), 'storage', 'tus-uploads');
    await expect(getTusUploadPath('abc')).resolves.toBe(path.join(baseDir, 'abc'));
  });
});
