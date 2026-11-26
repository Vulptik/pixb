import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Script } from 'node:vm';

// Next 16.4.4's vendored Flight client still omits the nonnegative end-time guard
// in its errored/aborted tracks. A 404 or redirect can leave end = -Infinity.
// Keep this local to development; never replace the browser's Performance API.
// Revisit when upgrading Next: https://github.com/react/react/pull/37563
const sites = [
  {
    context: 'error = root.reason;',
    end: 'childrenEndTime$jscomp$1',
  },
  {
    context: 'childrenEndTime$jscomp$3 = childrenEndTime;',
    end: 'childrenEndTime$jscomp$3',
  },
];

export function guardReactDevTiming(source) {
  let guarded = source;
  for (const { context, end } of sites) {
    const escaped = context.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(${escaped}\\s+if \\()(supportsUserTiming)(\\) \\{)`);
    const patchedPattern = new RegExp(
      `${escaped}\\s+if \\(supportsUserTiming && 0 <= ${end.replaceAll('$', '\\$')}\\) \\{`,
    );
    if (patchedPattern.test(guarded)) continue;
    if (!pattern.test(guarded)) {
      throw new Error('React development timing source changed; review or remove the local guard.');
    }
    guarded = guarded.replace(
      pattern,
      (_match, prefix, condition, suffix) => `${prefix}${condition} && 0 <= ${end}${suffix}`,
    );
  }
  return guarded;
}

export function patchReactDevTiming() {
  const require = createRequire(import.meta.url);
  const nextRoot = dirname(require.resolve('next/package.json'));
  const { version } = JSON.parse(readFileSync(join(nextRoot, 'package.json'), 'utf8'));
  if (version !== '16.4.4') {
    throw new Error(`Review the development timing guard for Next ${version}; it targets 16.4.4.`);
  }
  // Cover both dev bundlers. Production bundles are deliberately untouched.
  const updates = ['webpack', 'turbopack'].map((bundler) => {
    const name = `react-server-dom-${bundler}`;
    const filename = join(
      nextRoot,
      'dist',
      'compiled',
      name,
      'cjs',
      `${name}-client.browser.development.js`,
    );
    const source = readFileSync(filename, 'utf8');
    const guarded = guardReactDevTiming(source);
    new Script(guarded, { filename });
    return { filename, source, guarded };
  });
  // Validate every target before writing any of them.
  for (const { filename, source, guarded } of updates) {
    if (source !== guarded) writeFileSync(filename, guarded);
  }
}

if (import.meta.main) patchReactDevTiming();
