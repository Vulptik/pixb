// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addToastMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/primitives', () => ({
  addToast: addToastMock,
}));

describe('helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('shows deduplicated toasts with configured icons', async () => {
    const { showToast } = await import('@/lib/utils/helpers');

    showToast('Saved', 'success', 'Done');
    showToast('Saved', 'success', 'Done');
    vi.advanceTimersByTime(2001);
    showToast('Saved', 'success', 'Done');

    expect(addToastMock).toHaveBeenCalledTimes(2);
    expect(addToastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Saved',
        description: 'Done',
        color: 'success',
      }),
    );
  });
  it('assigns distinct identifiers to duplicate files before adding them to Uppy', async () => {
    const { uppyConfig } = await import('@/lib/utils/helpers');
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0.1).mockReturnValueOnce(0.2);
    const file = { id: 'same', name: 'photo.png' } as Parameters<
      NonNullable<typeof uppyConfig.onBeforeFileAdded>
    >[0];
    const other = { ...file };
    expect(uppyConfig.onBeforeFileAdded!(file, {})).toBe(file);
    uppyConfig.onBeforeFileAdded!(other, {});
    expect(file.id).toMatch(/^pixb-/);
    expect(other.id).not.toBe(file.id);
    random.mockRestore();
  });
  it.each(['development', 'test'])(
    'routes Uppy logging appropriately in %s',
    async (environment) => {
      vi.stubEnv('NODE_ENV', environment);
      const spies = [
        vi.spyOn(console, 'debug').mockImplementation(() => {}),
        vi.spyOn(console, 'warn'),
        vi.spyOn(console, 'error'),
      ];
      const { uppyConfig } = await import('@/lib/utils/helpers');
      const logger = uppyConfig.logger!;
      logger.debug('detail', 1);
      logger.warn('warning');
      logger.error('error');
      for (const spy of spies) {
        expect(spy).toHaveBeenCalledTimes(environment === 'development' ? 1 : 0);
        spy.mockRestore();
      }
      vi.unstubAllEnvs();
    },
  );
  it('treats status and description as part of the deduplication key', async () => {
    const { showToast } = await import('@/lib/utils/helpers');
    showToast('Saved');
    showToast('Saved');
    showToast('Saved', 'success');
    showToast('Saved', 'success', 'Details');
    expect(addToastMock).toHaveBeenCalledTimes(3);
  });
});
