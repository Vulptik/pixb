// Real PostgreSQL checks in a disposable container. No local app data is used.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const require = createRequire(import.meta.url);
const { assertMigrationState, loadMigrations, withClient } = require('../docker/db-check.js');
const container = `pixb-schema-check-${randomBytes(6).toString('hex')}`;
const password = randomBytes(24).toString('hex');
let prisma;
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}
try {
  docker([
    'run',
    '-d',
    '--name',
    container,
    '--mount',
    'type=tmpfs,destination=/var/lib/postgresql',
    '-p',
    '127.0.0.1::5432',
    '-e',
    `POSTGRES_PASSWORD=${password}`,
    '-e',
    'POSTGRES_DB=pixb',
    process.env.PIXB_DATABASE_IMAGE || 'pixb-postgres:local',
  ]);
  const port = docker(['port', container, '5432/tcp']).split(':').at(-1);
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/pixb?schema=public`;
  const result = spawnSync(process.execPath, ['scripts/deploy-schema.mjs'], {
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const owner = await prisma.user.create({
    data: {
      username: 'Owner',
      email: 'Owner@example.invalid',
      password_digest: 'fixture',
    },
  });
  const other = await prisma.user.create({
    data: {
      username: 'Other',
      email: 'other@example.invalid',
      password_digest: 'fixture',
    },
  });
  await assert.rejects(
    prisma.user.create({
      data: {
        username: 'owner',
        email: 'unique@example.invalid',
        password_digest: 'fixture',
      },
    }),
    { code: 'P2002' },
  );
  await assert.rejects(
    prisma.user.create({
      data: {
        username: 'unique',
        email: 'OWNER@example.invalid',
        password_digest: 'fixture',
      },
    }),
    { code: 'P2002' },
  );
  assert.equal(
    (await prisma.user.findUnique({ where: { email: 'OWNER@EXAMPLE.INVALID' } })).id,
    owner.id,
  );
  const collection = await prisma.collection.create({
    data: { name: 'Collection', user_id: owner.id },
  });
  const file = await prisma.media.create({
    data: {
      uid: 'same-owner',
      filename: 'file.txt',
      mime_type: 'text/plain',
      size: 1,
      file_data: 'fixture',
      user_id: owner.id,
      collections: { create: { collection_id: collection.id } },
    },
  });
  const foreign = await prisma.media.create({
    data: {
      uid: 'foreign',
      filename: 'foreign.txt',
      mime_type: 'text/plain',
      size: 1,
      file_data: 'fixture',
      user_id: other.id,
    },
  });
  await assert.rejects(
    prisma.collectionMedia.create({
      data: {
        collection_id: collection.id,
        media_id: foreign.id,
        user_id: owner.id,
      },
    }),
    { code: 'P2003' },
  );
  await assert.rejects(
    prisma.collectionMedia.create({
      data: {
        collection_id: collection.id,
        media_id: foreign.id,
        user_id: other.id,
      },
    }),
    { code: 'P2003' },
  );
  await prisma.collection.delete({ where: { id: collection.id } });
  assert.equal(await prisma.collectionMedia.count(), 0);
  assert.ok(await prisma.media.findUnique({ where: { id: file.id } }));
  for (const data of [{ quota: -1 }, { role: 7 }, { cached_quota_used: -1n }, { locale: 'xx' }])
    await assert.rejects(prisma.user.update({ where: { id: owner.id }, data }));
  // Historical stored preferences remain valid; the interface now offers only en/fr.
  for (const locale of ['en', 'fr', 'de', 'es', 'it'])
    await prisma.user.update({ where: { id: owner.id }, data: { locale } });
  await assert.rejects(prisma.media.update({ where: { id: file.id }, data: { size: 0 } }));
  await assert.rejects(
    prisma.authChallenge.create({
      data: {
        challenge: 'missing-owner',
        type: 'totp',
        expires_at: new Date(Date.now() + 60000),
      },
    }),
  );
  await prisma.authChallenge.create({
    data: {
      challenge: 'owned',
      type: 'totp',
      user_id: other.id,
      expires_at: new Date(Date.now() + 60000),
    },
  });
  await prisma.user.delete({ where: { id: other.id } });
  assert.equal(await prisma.authChallenge.count(), 0);
  console.log(
    'PASS case-insensitive uniqueness, constraints, owner-bound memberships, nested writes and cascades',
  );

  await prisma.$executeRaw`INSERT INTO users (id, username, email, password_digest, updated_at)
    SELECT 100 + n, 'fixture' || n, 'fixture' || n || '@example.invalid', 'fixture', now() FROM generate_series(1, 20) n`;
  await prisma.$executeRaw`INSERT INTO medias
    (uid, filename, mime_type, size, file_data, user_id, created_at, updated_at, is_favorite, is_shared)
    SELECT 'fixture-' || n, CASE WHEN n % 10007 = 0 THEN 'rare-sunset-' || n ELSE 'file-' || n END,
      'image/jpeg', 1024, 'fixture', 101 + n % 20, now() - n * interval '1 second', now(),
      n % 7 = 0, n % 11 = 0 FROM generate_series(1, 100000) n`;
  await prisma.$executeRawUnsafe('ANALYZE medias');
  const queries = [
    [
      'library',
      'WHERE user_id = 105 ORDER BY created_at DESC, id DESC LIMIT 40',
      'medias_user_id_created_at_id_idx',
    ],
    [
      'oldest',
      'WHERE user_id = 105 ORDER BY created_at ASC, id ASC LIMIT 40',
      'medias_user_id_created_at_id_idx',
    ],
    [
      'favorites',
      'WHERE user_id = 105 AND is_favorite = true ORDER BY created_at DESC, id DESC LIMIT 40',
      'medias_user_id_is_favorite_created_at_id_idx',
    ],
    [
      'shared',
      'WHERE user_id = 105 AND is_shared = true ORDER BY created_at DESC, id DESC LIMIT 40',
      'medias_user_id_is_shared_created_at_id_idx',
    ],
    [
      'search',
      "WHERE user_id = 105 AND filename ILIKE '%rare-sunset%' ORDER BY created_at DESC, id DESC LIMIT 40",
      'medias_filename_idx',
    ],
  ];
  for (const [name, query, index] of queries) {
    const plan = await prisma.$queryRawUnsafe(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM medias ${query}`,
    );
    assert.ok(
      JSON.stringify(plan).includes(index),
      `${name}: expected ${index}: ${JSON.stringify(plan)}`,
    );
    console.log(`PASS ${name}: ${index}`);
  }
  const checksums = loadMigrations();
  const client = { query: async (sql) => ({ rows: await prisma.$queryRawUnsafe(sql) }) };
  await assertMigrationState(client, [...checksums.keys()], checksums);
  await prisma.$executeRaw`UPDATE _prisma_migrations SET checksum = 'different'`;
  await assert.rejects(
    assertMigrationState(client, [...checksums.keys()], checksums),
    /initial schema differs/,
  );
  console.log('PASS initial schema history and checksum refusal');
  await withClient(url, async (client) => {
    await assert.rejects(
      client.query(readFileSync('prisma/migrations/20261102000000_init/migration.sql', 'utf8')),
      /requires a fresh database/,
    );
    await client.query('ROLLBACK');
  });
  assert.equal(await prisma.media.count(), 100001);
  console.log('PASS initial SQL refuses populated databases without changing their data');
} finally {
  await prisma?.$disconnect();
  docker(['rm', '-f', container]);
}
