// Build-time only. Extend Next's standalone output for the container's Node
// entrypoints instead of overwriting it with the entire production dependency tree.
import { access, cp, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { nodeFileTrace } = require('next/dist/compiled/@vercel/nft');
const { ensureNeededBinariesExist, getEnginesPath } = require('@prisma/engines');
const { download } = require('@prisma/fetch-engine');
const root = process.cwd();
const standalone = path.join(root, '.next/standalone');
const config = path.join(root, 'prisma.config.ts');
await access(path.join(standalone, 'server.js'));

// npm ci deliberately skips install scripts. Fetch the target platform's schema
// engine now, so first startup/migrate deploy also works without internet access.
await ensureNeededBinariesExist({ download });
const engineDirectory = getEnginesPath();
const engines = (await readdir(engineDirectory)).filter((name) =>
  name.startsWith('schema-engine-'),
);
if (engines.length !== 1) throw new Error('Expected one native Prisma migration engine.');

const { fileList, warnings } = await nodeFileTrace(
  [
    'node_modules/prisma/build/index.js',
    'prisma.config.ts',
    'docker/startup.js',
    'docker/db-check.js',
    'docker/config.js',
    'docker/backup.js',
  ],
  {
    base: root,
    processCwd: root,
    async readFile(filename) {
      let source;
      try {
        source = await readFile(filename, 'utf8');
      } catch (error) {
        // Match NFT's default reader: absent candidates are normal while Node
        // resolution tries files, directories, nested modules, then parents.
        if (error.code === 'ENOENT' || error.code === 'EISDIR') return null;
        throw error;
      }
      // NFT parses JavaScript; Prisma itself loads the original TS config via
      // jiti at runtime. Transpile only the analysis input to trace its imports.
      return filename === config
        ? ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
          }).outputText
        : source;
    },
  },
);

// Optional adapters for other runtimes/databases and debug formatters are not
// installed. Other missing dependencies fail the build.
const optionalModules = new Set([
  'pg-native',
  'better-sqlite3',
  'bun:jsc',
  'bun:sqlite',
  'jsr:@db/sqlite@0.13.0',
  'cloudflare:sockets',
  'cloudflare:workers',
  'source-map-support',
  'cardinal',
]);
const unresolved = [];
for (const warning of warnings) {
  const missing = warning.message.match(/^Failed to resolve dependency "([^"]+)"/);
  if (missing && !optionalModules.has(missing[1])) unresolved.push(warning.message);
}
if (unresolved.length) throw new Error(unresolved.join('\n'));

fileList.add(path.relative(root, path.join(engineDirectory, engines[0])));
const packageDirectories = [...fileList]
  .filter((filename) => filename.startsWith('node_modules/') && filename.endsWith('/package.json'))
  .map((filename) => path.dirname(filename));
for (const directory of packageDirectories) {
  for (const name of await readdir(path.join(root, directory))) {
    if (/^(licen[cs]e|notice|copying)(\.|$)/i.test(name)) fileList.add(path.join(directory, name));
  }
}

let copied = 0;
for (const filename of fileList) {
  if (!filename.startsWith('node_modules/')) continue;
  const destination = path.join(standalone, filename);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.join(root, filename), destination, { verbatimSymlinks: true });
  copied++;
}
console.log(`Packaged ${copied} traced startup/migration files, including the native engine.`);
