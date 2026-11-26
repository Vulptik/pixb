import { describe, expect, it, vi } from 'vitest';
import { guardReactDevTiming } from '../../scripts/patch-react-dev-timing.mjs';

// Reproduce both vendored Flight branches with the native measurement contract.
const source = `
  var supportsUserTiming = true;
  var root = { reason: 'interrupted render' };
  var childrenEndTime$jscomp$0 = end;
  var childrenEndTime = end;
  var childrenEndTime$jscomp$1 = childrenEndTime$jscomp$0,
      error = root.reason;
  if (supportsUserTiming) {
    measure('errored', { start: 0, end: childrenEndTime$jscomp$1 });
  }
  var childrenEndTime$jscomp$3 = childrenEndTime;
  if (supportsUserTiming) {
    measure('aborted', { start: 0, end: childrenEndTime$jscomp$3 });
  }
`;

describe('local React development timing guard', () => {
  it.each([-Infinity, -1, NaN])('skips invalid end time %s in both tracks', (end) => {
    const measure = vi.fn((_name, options) => {
      if (!(options.end >= 0)) throw new TypeError('negative timestamp');
    });
    expect(() => new Function('end', 'measure', source)(end, measure)).toThrow();
    measure.mockClear();
    new Function('end', 'measure', guardReactDevTiming(source))(end, measure);
    expect(measure).not.toHaveBeenCalled();
  });

  it.each([0, 12.5])('preserves valid measurements ending at %s', (end) => {
    const measure = vi.fn();
    new Function('end', 'measure', guardReactDevTiming(source))(end, measure);
    expect(measure.mock.calls).toEqual([
      ['errored', { start: 0, end }],
      ['aborted', { start: 0, end }],
    ]);
  });

  it('can run on every dev start without changing an already guarded client', () => {
    const guarded = guardReactDevTiming(source);
    expect(guardReactDevTiming(guarded)).toBe(guarded);
  });

  it('requires review if a dependency update changes either branch', () => {
    expect(() =>
      guardReactDevTiming(source.replace('error = root.reason;', 'error = null;')),
    ).toThrow('source changed');
  });
});
